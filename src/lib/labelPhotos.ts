/**
 * Label a listing's photos with the vision model (categorizePhotos in
 * src/lib/ai.ts). Shared by POST /api/photos/categorize (one listing, from
 * the listing pages) and the `relabel_photos` background job (many listings).
 *
 * Cost guards (unchanged from the route): only photos still "Other"/blank
 * are sent — a category a person chose by hand (category_source = 'manual')
 * is never touched, and photos the model already labelled are skipped unless
 * `force`. Photos go 8 per model call as 800px previews.
 *
 * The model answers with a short plain vocabulary ("Stateroom", "Head" —
 * src/lib/aiPhotoLabels.ts), so `force` never re-labels a photo whose
 * specific area came from its file name (or from before sources were
 * recorded): that would swap the photographer's "Port Guest Stateroom" for
 * a plain "Stateroom".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { categorizePhotos } from "@/lib/ai";
import { signResizedPath } from "@/lib/photoStore";

export const LABEL_BATCH = 8;

type PhotoRow = { id: string; storage_path: string; category: string | null; category_source: string | null };

/** Would labelling consider this photo? (see the cost guards above) */
export function isLabelCandidate(p: { category: string | null; category_source: string | null }, force?: boolean): boolean {
  if (p.category_source === "manual") return false;
  const unplaced = !p.category || p.category === "Other";
  if (force) return unplaced || p.category_source === "ai";
  if (p.category_source === "ai") return false;
  return unplaced;
}

export type LabelListingResult = {
  updated: { id: string; category: string }[];
  /** Candidates from startPos on. */
  considered: number;
  unsure: number;
  /**
   * Position (in the listing's display order) to resume from: every candidate
   * before it was sent and saved. Always > startPos when anything was sent,
   * so paging by it ends even with `force` (a re-labelled photo is still a
   * candidate, but it sits behind the cursor).
   */
  nextPos: number;
  /** Candidates at nextPos or later — not attempted (or in a failed batch). */
  remaining: number;
  /** Every candidate from startPos on was sent. */
  complete: boolean;
  /** A model call failed; `updated` holds everything that was saved. */
  error?: string;
};

/** Model calls in flight at once (each is LABEL_BATCH photos). */
export const LABEL_CONCURRENCY = 3;

export async function labelListingPhotos(
  svc: SupabaseClient,
  listingId: string,
  opts: {
    force?: boolean;
    photoIds?: string[];
    /** Skip the first N photos in display order (job resume / route paging). */
    startPos?: number;
    /** Stop STARTING new model calls once this time (epoch ms) is near; calls in flight finish. */
    deadlineMs?: number;
    /** Abort a model call still running at this time (epoch ms) — the route's last-resort stop. */
    hardStopMs?: number;
    /** Take on at most this many candidates in this call (route paging). */
    maxPhotos?: number;
  } = {}
): Promise<LabelListingResult> {
  let q = svc
    .from("photos")
    .select("id, storage_path, category, category_source")
    .eq("listing_id", listingId)
    .order("display_order")
    .order("id");
  if (Array.isArray(opts.photoIds) && opts.photoIds.length) q = q.in("id", opts.photoIds.slice(0, 200));
  const { data } = await q;
  const photos = (data ?? []) as PhotoRow[];
  const startPos = Math.max(0, opts.startPos ?? 0);

  // Candidates with their position in the listing's order, so a caller can
  // resume after the last photo it sent.
  const candidates: { p: PhotoRow; pos: number }[] = [];
  for (let pos = startPos; pos < photos.length; pos++) {
    if (isLabelCandidate(photos[pos], opts.force)) candidates.push({ p: photos[pos], pos });
  }

  // This call's share, cut into model batches. Batches are disjoint slices of
  // the candidate list, so no photo is ever in two batches (or written twice).
  const take = opts.maxPhotos && opts.maxPhotos > 0 ? candidates.slice(0, opts.maxPhotos) : candidates;
  const batches: { p: PhotoRow; pos: number }[][] = [];
  for (let i = 0; i < take.length; i += LABEL_BATCH) batches.push(take.slice(i, i + LABEL_BATCH));

  const updated: { id: string; category: string }[] = [];
  let unsure = 0;
  let slowest = 0;
  let error: string | undefined;
  /** Per batch: "done" once its labels are saved; "failed" / undefined (never started) otherwise. */
  const status: ("done" | "failed" | undefined)[] = batches.map(() => undefined);

  async function runBatch(batch: { p: PhotoRow; pos: number }[], b: number): Promise<void> {
    const t0 = Date.now();
    // Supabase resize, or the stored copy for an original on R2 (photoStore).
    const urls = await Promise.all(batch.map(({ p }) =>
      signResizedPath(svc, p.storage_path, 600, { width: 800, height: 800, resize: "contain", quality: 70 }, { ensure: true })
    ));
    const usable = batch.map(({ p }, j) => ({ p, url: urls[j] })).filter((x) => x.url) as { p: PhotoRow; url: string }[];

    if (usable.length) {
      let labels: (string | null)[] = [];
      try {
        const timeoutMs = opts.hardStopMs ? Math.max(1_000, opts.hardStopMs - Date.now()) : undefined;
        labels = await categorizePhotos(usable.map((u) => ({ url: u.url })), { timeoutMs });
      } catch (err) {
        status[b] = "failed";
        // Cut off at the caller's hard stop: not a failure, just out of time —
        // the batch is left for the next call (it sits at/after nextPos).
        if (opts.hardStopMs && Date.now() >= opts.hardStopMs - 250) return;
        if (!error) error = err instanceof Error ? err.message : "AI request failed";
        return;
      }

      await Promise.all(usable.map(async ({ p }, j) => {
        const label = labels[j];
        if (!label) {
          unsure++;
          // Re-labelling, and the model is no longer sure about its own
          // earlier answer (often an over-specific one like "Master
          // Stateroom"): put the photo back to Other rather than keep the
          // guess. Source cleared so a later "Label photos" tries it again.
          if (p.category_source === "ai" && p.category && p.category !== "Other") {
            const { error: e } = await svc.from("photos").update({ category: "Other", category_source: null }).eq("id", p.id);
            if (!e) updated.push({ id: p.id, category: "Other" });
          }
          return;
        }
        if (label === p.category && p.category_source === "ai") return;
        const { error: e } = await svc.from("photos").update({ category: label, category_source: "ai" }).eq("id", p.id);
        if (!e) updated.push({ id: p.id, category: label });
      }));
    }
    status[b] = "done";
    slowest = Math.max(slowest, Date.now() - t0);
  }

  // LABEL_CONCURRENCY lanes pull the next batch in order. A lane doesn't START
  // a batch once the deadline is near (or after a model error — likely a rate
  // limit or outage); batches already in flight always finish.
  let nextBatch = 0;
  const lanes = Array.from({ length: Math.min(LABEL_CONCURRENCY, batches.length) }, async () => {
    while (nextBatch < batches.length && !error) {
      if (opts.deadlineMs && nextBatch > 0 && Date.now() + Math.max(8_000, slowest * 1.3) > opts.deadlineMs) return;
      const b = nextBatch++;
      try {
        await runBatch(batches[b], b);
      } catch (err) {
        // Signing or a database call threw — treat like a failed model call.
        status[b] = "failed";
        if (!error) error = err instanceof Error ? err.message : "Labelling failed";
      }
    }
  });
  await Promise.all(lanes);

  // Resume point: just after the last batch of the unbroken run of finished
  // ones. A batch after a failed / unstarted one may have been saved too; the
  // next call simply sees it again (no longer a candidate unless `force`).
  let firstOpen = 0;
  while (firstOpen < batches.length && status[firstOpen] === "done") firstOpen++;
  const allTaken = take.length === candidates.length;
  const complete = firstOpen === batches.length && allTaken && !error;
  const nextPos = complete
    ? photos.length
    : firstOpen < batches.length
      ? batches[firstOpen][0].pos
      : take.length < candidates.length ? candidates[take.length].pos : photos.length;
  const remaining = complete ? 0 : candidates.filter((c) => c.pos >= nextPos).length;

  return { updated, considered: candidates.length, unsure, nextPos, remaining, complete, ...(error ? { error } : {}) };
}
