/**
 * Label a listing's photos with the vision model (categorizePhotos in
 * src/lib/ai.ts). Shared by POST /api/photos/categorize (one listing, from
 * the listing pages) and the `relabel_photos` background job (many listings).
 *
 * Cost guards (unchanged from the route): only photos whose category was
 * guessed or is still "Other"/blank are sent — a category a person chose by
 * hand (category_source = 'manual') is never touched, and photos the model
 * already labelled are skipped unless `force`. Photos go 8 per model call as
 * 800px previews.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { categorizePhotos } from "@/lib/ai";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import { signResizedPath } from "@/lib/photoStore";

export const LABEL_BATCH = 8;

type PhotoRow = { id: string; storage_path: string; category: string | null; category_source: string | null };

/** The labels the model may use: standard categories (minus Other) + custom ones. */
export async function labelCategories(svc: SupabaseClient): Promise<string[]> {
  const { data: custom } = await svc.from("custom_photo_categories").select("name");
  return Array.from(new Set([...PHOTO_CATEGORIES.filter((c) => c !== "Other"), ...(custom ?? []).map((c) => c.name as string)]));
}

/** Would labelling consider this photo? (see the cost guards above) */
export function isLabelCandidate(p: { category: string | null; category_source: string | null }, force?: boolean): boolean {
  if (p.category_source === "manual") return false;
  if (force) return true;
  if (p.category_source === "ai") return false;
  return !p.category || p.category === "Other";
}

export type LabelListingResult = {
  updated: { id: string; category: string }[];
  /** Candidates from startPos on. */
  considered: number;
  unsure: number;
  /** Position (in the listing's display order) to resume from. */
  nextPos: number;
  /** Every candidate from startPos on was sent. */
  complete: boolean;
  /** The model call failed; `updated` holds what was saved before it. */
  error?: string;
};

export async function labelListingPhotos(
  svc: SupabaseClient,
  listingId: string,
  opts: {
    force?: boolean;
    photoIds?: string[];
    /** Skip the first N photos in display order (job resume). */
    startPos?: number;
    /** Stop starting new model calls once this time (epoch ms) is near. */
    deadlineMs?: number;
    categories?: string[];
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

  const categories = opts.categories ?? (await labelCategories(svc));

  // Candidates with their position in the listing's order, so a job can
  // resume after the last photo it sent.
  const candidates: { p: PhotoRow; pos: number }[] = [];
  for (let pos = startPos; pos < photos.length; pos++) {
    if (isLabelCandidate(photos[pos], opts.force)) candidates.push({ p: photos[pos], pos });
  }

  const updated: { id: string; category: string }[] = [];
  let unsure = 0;
  let nextPos = startPos;
  let slowest = 0;

  for (let i = 0; i < candidates.length; i += LABEL_BATCH) {
    if (opts.deadlineMs && i > 0 && Date.now() + Math.max(8_000, slowest * 1.3) > opts.deadlineMs) {
      return { updated, considered: candidates.length, unsure, nextPos, complete: false };
    }
    const t0 = Date.now();
    const batch = candidates.slice(i, i + LABEL_BATCH);
    // Supabase resize, or the stored copy for an original on R2 (photoStore).
    const urls = await Promise.all(batch.map(({ p }) =>
      signResizedPath(svc, p.storage_path, 600, { width: 800, height: 800, resize: "contain", quality: 70 }, { ensure: true })
    ));
    const usable = batch.map(({ p }, j) => ({ p, url: urls[j] })).filter((x) => x.url) as { p: PhotoRow; url: string }[];

    if (usable.length) {
      let labels: (string | null)[] = [];
      try {
        labels = await categorizePhotos(usable.map((u) => ({ url: u.url })), categories);
      } catch (err) {
        const message = err instanceof Error ? err.message : "AI request failed";
        return { updated, considered: candidates.length, unsure, nextPos, complete: false, error: message };
      }

      await Promise.all(usable.map(async ({ p }, j) => {
        const label = labels[j];
        if (!label) { unsure++; return; }
        if (label === p.category && p.category_source === "ai") return;
        const { error } = await svc.from("photos").update({ category: label, category_source: "ai" }).eq("id", p.id);
        if (!error) updated.push({ id: p.id, category: label });
      }));
    }

    nextPos = batch[batch.length - 1].pos + 1;
    slowest = Math.max(slowest, Date.now() - t0);
  }

  return { updated, considered: candidates.length, unsure, nextPos: photos.length, complete: true };
}
