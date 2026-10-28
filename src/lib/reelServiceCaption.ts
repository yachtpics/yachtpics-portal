import type { SupabaseClient } from "@supabase/supabase-js";
import { draftReelCopy, isAiConfigured, type DescribableListing } from "@/lib/ai";
import { orderPhotos } from "@/lib/photoOrder";
import {
  photosForAngle, reelServiceCaption, REEL_SERVICE_ANGLES,
  type ReelServiceAngle, type ReelServiceSettings,
} from "@/lib/reelService";
import { signResizedPath } from "@/lib/photoStore";

/**
 * "Rewrite" for a Reel Service caption (Oct 23). The planner writes a
 * templated caption; a broker who doesn't like it (or Charlie, on the board)
 * asks for a fresh one.
 *
 * With AI configured the model writes it from the reel's own photographs (the
 * job's planned photos first — so an Inside reel is written from the rooms —
 * topped up from the angle's set and then display order, ten frames at most),
 * in the same register as the Reel Maker's "Write it again". Without AI, or if
 * the model fails, the next templated variant.
 *
 * Counters (migration 20261023b): caption_variant, caption_rewrites,
 * caption_rewritten_at. Before that migration is applied everything still
 * works — just without the cap, and the template rotates on the current
 * caption instead of a stored variant.
 */

/** Total rewrites one reel can have. */
export const MAX_CAPTION_REWRITES = 30;
/** Minimum gap between rewrites of the same reel. */
const REWRITE_COOLDOWN_MS = 60 * 1000;

const LISTING_SELECT =
  "id, vessel_name, vessel_type, year, make, model, length_ft, beam_ft, draft_ft, staterooms, heads, engines, engine_hours, fuel_type, cruising_speed_kn, max_speed_kn, hull_material, location, asking_price, description, hero_photo_id, photo_order_manual";

type CaptionJob = {
  id: string; broker_id: string; listing_id: string; status: string; angle: string;
  caption: string | null; settings: ReelServiceSettings | null;
  caption_variant?: number | null; caption_rewrites?: number | null; caption_rewritten_at?: string | null;
};

type CaptionListing = DescribableListing & { id: string; hero_photo_id: string | null; photo_order_manual: boolean | null };

type PhotoRow = { id: string; storage_path: string; category: string | null; display_order: number | null; filename: string | null };

export type RewriteResult =
  | { ok: true; caption: string; source: "ai" | "template" }
  | { ok: false; error: string; status: number };

const missingColumn = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(e.message ?? ""));

const BASE_JOB_SELECT = "id, broker_id, listing_id, status, angle, caption, settings";

/** The job, with the counter columns when they exist. */
async function loadJob(svc: SupabaseClient, jobId: string): Promise<{ job: CaptionJob | null; counters: boolean }> {
  const full = await svc.from("reel_service_jobs")
    .select(`${BASE_JOB_SELECT}, caption_variant, caption_rewrites, caption_rewritten_at`)
    .eq("id", jobId).maybeSingle();
  if (!full.error) return { job: (full.data as CaptionJob | null) ?? null, counters: true };
  if (!missingColumn(full.error)) return { job: null, counters: false };
  const base = await svc.from("reel_service_jobs").select(BASE_JOB_SELECT).eq("id", jobId).maybeSingle();
  return { job: (base.data as CaptionJob | null) ?? null, counters: false };
}

const isAngle = (a: string): a is ReelServiceAngle => (REEL_SERVICE_ANGLES as readonly string[]).indexOf(a) >= 0;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** The next templated caption that differs from the current one. */
function nextTemplate(listing: CaptionListing, angle: ReelServiceAngle, job: CaptionJob, counters: boolean): { caption: string; variant: number } {
  const current = job.caption ?? "";
  let start: number;
  if (counters && typeof job.caption_variant === "number") {
    start = job.caption_variant + 1;
  } else {
    // No stored variant: find which one wrote the current caption, else rotate on its hash.
    start = -1;
    for (let v = 0; v < 12; v++) if (reelServiceCaption(listing, angle, v) === current) { start = v + 1; break; }
    if (start < 0) start = current ? (hashString(current) % 12) + 1 : (job.settings?.variant ?? 0) + 1;
  }
  for (let k = 0; k < 12; k++) {
    const caption = reelServiceCaption(listing, angle, start + k);
    if (caption !== current) return { caption, variant: start + k };
  }
  return { caption: reelServiceCaption(listing, angle, start), variant: start };
}

/** Up to ten frames for the writer: the reel's own photos, then the angle's, then display order. */
async function framesFor(svc: SupabaseClient, listing: CaptionListing, job: CaptionJob, angle: ReelServiceAngle): Promise<{ url: string; category: string | null }[]> {
  const { data } = await svc.from("photos")
    .select("id, storage_path, category, display_order, filename")
    .eq("listing_id", listing.id).eq("is_visible", true);
  const rows = (data ?? []) as PhotoRow[];
  if (rows.length === 0) return [];
  const ordered = orderPhotos(rows, { manual: listing.photo_order_manual === true, heroId: listing.hero_photo_id });
  const byId = new Map(ordered.map((p) => [p.id, p]));
  const planned = (job.settings?.photoIds ?? []).map((id) => byId.get(id)).filter((p): p is PhotoRow => !!p);
  const forAngle = (photosForAngle(ordered, angle, job.settings?.variant ?? 0, listing.hero_photo_id) ?? [])
    .map((p) => byId.get(p.id)).filter((p): p is PhotoRow => !!p);
  const picked: PhotoRow[] = [];
  [...planned, ...forAngle, ...ordered].forEach((p) => { if (picked.length < 10 && picked.indexOf(p) < 0) picked.push(p); });

  // Signed the same way the Reel Maker's reel-copy route signs them.
  return (await Promise.all(picked.map(async (p) => {
    const url = await signResizedPath(svc, p.storage_path, 600, { width: 800, height: 800, resize: "contain", quality: 70 }, { ensure: true });
    return url ? { url, category: p.category ?? null } : null;
  }))).filter(Boolean) as { url: string; category: string | null }[];
}

/** The AI caption + hashtags, Reel Service's #YachtForSale first. Null on any failure. */
async function aiCaption(svc: SupabaseClient, listing: CaptionListing, job: CaptionJob, angle: ReelServiceAngle): Promise<string | null> {
  if (!isAiConfigured()) return null;
  try {
    const frames = await framesFor(svc, listing, job, angle);
    if (frames.length === 0) return null;
    const copy = await draftReelCopy(listing, frames);
    if (!copy.caption) return null;
    const rest = copy.hashtags.filter((t) => t.toLowerCase() !== "#yachtforsale");
    return `${copy.caption}\n\n${["#YachtForSale", ...rest].join(" ")}`;
  } catch {
    return null;
  }
}

/**
 * Write a fresh caption for one Reel Service job and save it.
 * `enforceLimit` (brokers): at most MAX_CAPTION_REWRITES per reel, one a minute.
 */
export async function rewriteReelServiceCaption(
  svc: SupabaseClient,
  jobId: string,
  opts: { enforceLimit?: boolean } = {},
): Promise<RewriteResult> {
  const { job, counters } = await loadJob(svc, jobId);
  if (!job) return { ok: false, error: "Reel not found.", status: 404 };

  if (counters && opts.enforceLimit) {
    if ((job.caption_rewrites ?? 0) >= MAX_CAPTION_REWRITES) {
      return { ok: false, error: "That’s as many rewrites as this reel gets — edit the caption by hand after copying it.", status: 429 };
    }
    const last = job.caption_rewritten_at ? new Date(job.caption_rewritten_at).getTime() : 0;
    if (last && Date.now() - last < REWRITE_COOLDOWN_MS) {
      return { ok: false, error: "Give it a minute before rewriting again.", status: 429 };
    }
  }

  const { data: listing } = await svc.from("listings").select(LISTING_SELECT).eq("id", job.listing_id).maybeSingle();
  if (!listing) return { ok: false, error: "Listing not found.", status: 404 };
  const l = listing as CaptionListing;
  const angle: ReelServiceAngle = isAngle(job.angle) ? job.angle : "full_tour";

  const fromAi = await aiCaption(svc, l, job, angle);
  const tpl = fromAi ? null : nextTemplate(l, angle, job, counters);
  const caption = fromAi ?? tpl!.caption;

  const patch: Record<string, unknown> = { caption };
  if (counters) {
    patch.caption_rewrites = (job.caption_rewrites ?? 0) + 1;
    patch.caption_rewritten_at = new Date().toISOString();
    if (tpl) patch.caption_variant = tpl.variant;
  }
  let { error } = await svc.from("reel_service_jobs").update(patch).eq("id", job.id);
  if (error && missingColumn(error)) ({ error } = await svc.from("reel_service_jobs").update({ caption }).eq("id", job.id));
  if (error) return { ok: false, error: error.message, status: 500 };
  return { ok: true, caption, source: fromAi ? "ai" : "template" };
}
