import type { SupabaseClient } from "@supabase/supabase-js";
import { orderPhotos } from "@/lib/photoOrder";
import { isExterior, REEL_STYLES, type StyleKey } from "@/lib/reelStyles";

/**
 * Reel Service
 * ------------
 * A paid add-on (billed outside the app): YachtPics delivers social reels
 * every month for EACH active listing of an enrolled broker —
 * `reels_per_listing` a month (default 4).
 *
 * This file is the PLANNER. Once a month (and safely every day after — it only
 * fills what's missing) it writes one `reel_service_jobs` row per reel owed:
 * which listing, which angle (Full tour / Underway & exterior / Inside /
 * Details), which look, the photographs in order, the video clips and where
 * to cut them, and a caption. Nothing is rendered here: the admin page renders
 * each job in Charlie's browser with the ordinary ReelMaker engine, driven by
 * these settings.
 *
 * A listing's reels in one month must not look alike: they take the four
 * angles where the photos allow, four different looks, different clips and
 * moments in them, and different photo subsets; last month's angle+look
 * pairs on the same listing are avoided where possible.
 */

export const REEL_SERVICE_ANGLES = ["full_tour", "underway_exterior", "inside", "details"] as const;
export type ReelServiceAngle = (typeof REEL_SERVICE_ANGLES)[number];

export const ANGLE_LABEL: Record<ReelServiceAngle, string> = {
  full_tour: "Full tour",
  underway_exterior: "Underway & exterior",
  inside: "Inside",
  details: "Details",
};

/** The looks the service rotates through — the strong social ones. */
export const REEL_SERVICE_LOOKS: StyleKey[] = ["underway", "marquee", "cinematic", "walkthrough", "energy", "stack", "stack_underway"];

/** Stack and Stack Underway play no clips (ReelMaker leaves them out). */
export function lookPlaysClips(look: StyleKey): boolean {
  return REEL_STYLES[look]?.layout !== "stack";
}

/**
 * Clips per reel-service render. ReelMaker's own picker allows 3 (2 on a
 * phone); the engine itself has no cap — each clip holds one decoder and a
 * pool of four frame canvases open for the render. These render on Charlie's
 * desktop, so the service goes to 5.
 */
export const REEL_SERVICE_CLIP_MAX = 5;

/** A listing needs at least this many visible photos to be planned at all. */
export const MIN_LISTING_PHOTOS = 8;
/** An angle needs this many photos of its own kind, or it falls back to Full tour. */
const MIN_ANGLE_PHOTOS = 8;

export type ReelServiceClip = { videoId: string; inFrac: number; lengthSec: 2 | 3 | 4 };

/**
 * Everything ReelMaker needs to render a job. `order` is the play order:
 * photo ids, and "clip:N" for clips[N].
 */
export type ReelServiceSettings = {
  order: string[];
  photoIds: string[];
  clips: ReelServiceClip[];
  length: "short" | "full" | "long";
  fit: "whole" | "fill";
  showPrice: boolean;
  showLocation: boolean;
  variant: number;
  /** The listing's very first reel (slot 1 of its first month): a Full tour. */
  launch?: boolean;
};

export type ReelServiceJobStatus = "planned" | "rendering" | "ready" | "delivered" | "failed";

/** "YYYY-MM" for an instant, in Eastern time. */
export function periodET(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

export function isPeriod(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// ── Photo choice per angle ───────────────────────────────────────────────────

type PhotoRow = { id: string; category: string | null; display_order: number | null };
type VideoRow = { id: string; display_order: number | null };
type ListingRow = {
  id: string; broker_id: string; vessel_name: string | null; vessel_type: string | null; year: number | null;
  make: string | null; model: string | null; length_ft: number | null; location: string | null;
  hero_photo_id: string | null; photo_order_manual: boolean | null; created_at: string;
};

const lc = (c: string | null) => (c ?? "").trim().toLowerCase();

/** Running, aerial and profile shots lead the Underway angle, in this order. */
const UNDERWAY_LEAD = ["profiles running", "aerial", "profiles", "tower"];
const INSIDE = new Set([
  "salon", "galley", "dinette", "dining", "pantry", "foyer", "main deck foyer", "skylounge", "skylounge day head",
  "day head", "companionway", "lower companionway", "lower foyer", "cabin", "aft cabin", "aft berth", "forward cabin",
  "laundry", "port passageway", "starboard passageway",
]);
const DETAILS = new Set([
  "helm", "console", "navigation station", "pilothouse", "cockpit", "seating", "engine room", "port engine room",
  "starboard engine room", "engines", "engine", "generator room", "mechanical room", "electrical room",
  "electrical panel", "lazarette", "command deck", "flybridge", "enclosed flybridge", "tower", "swim platform", "beach club",
]);
const isInside = (c: string | null) => {
  const k = lc(c);
  if (INSIDE.has(k)) return true;
  return k.indexOf("stateroom") >= 0 || /\bhead\b/.test(k);
};
const isDetail = (c: string | null) => DETAILS.has(lc(c));
const isRunningOrAerial = (c: string | null) => UNDERWAY_LEAD.indexOf(lc(c)) >= 0;

/** Pick `n` from a list, spread evenly, starting `offset` steps in. Keeps order. */
function spread<T>(list: T[], n: number, offset = 0): T[] {
  if (list.length <= n) return list.slice();
  const out: T[] = [];
  const step = list.length / n;
  const shift = (offset % 3) * (step / 3);
  for (let i = 0; i < n; i++) out.push(list[Math.min(list.length - 1, Math.floor(i * step + shift))]);
  // Duplicates can only come from rounding at the very end; drop them.
  return out.filter((x, i) => out.indexOf(x) === i);
}

function uniq<T>(list: T[]): T[] {
  return list.filter((x, i) => list.indexOf(x) === i);
}

/**
 * The photographs for one angle, in play order, or null when the listing
 * hasn't enough of that kind of photo. `variant` shifts which photos a repeat
 * of the same angle takes, and which exterior opens it.
 */
export function photosForAngle(
  ordered: PhotoRow[],
  angle: ReelServiceAngle,
  variant: number,
  heroId: string | null,
): PhotoRow[] | null {
  if (ordered.length === 0) return null;
  const hero = ordered.find((p) => p.id === heroId) ?? ordered[0];
  const exteriors = ordered.filter((p) => isExterior(p.category) || isRunningOrAerial(p.category));
  // The title sits on the first photograph: always the boat, never a cupboard.
  const opener = (pool: PhotoRow[]) => {
    const ext = exteriors.length ? exteriors : [hero];
    if (variant === 0 && (isExterior(hero.category) || exteriors.length === 0)) return hero;
    const choices = ext.filter((p) => pool.indexOf(p) < 0);
    const from = choices.length ? choices : ext;
    return from[variant % from.length];
  };

  if (angle === "full_tour") {
    const rest = ordered.filter((p) => p.id !== hero.id);
    const first = variant === 0 ? hero : opener([]);
    const body = spread(rest.filter((p) => p.id !== first.id), 17, variant);
    return uniq([first, ...body]);
  }

  if (angle === "underway_exterior") {
    const lead: PhotoRow[] = [];
    for (let i = 0; i < UNDERWAY_LEAD.length; i++) {
      ordered.forEach((p) => { if (lc(p.category) === UNDERWAY_LEAD[i]) lead.push(p); });
    }
    const otherExt = exteriors.filter((p) => lead.indexOf(p) < 0);
    const ext = uniq([...lead, ...otherExt]);
    if (ext.length < MIN_ANGLE_PHOTOS) return null;
    // Rotate the lead so a second Underway reel opens on a different shot.
    const k = ext.length > 1 ? variant % Math.min(ext.length, Math.max(1, lead.length || 1)) : 0;
    const rotated = k ? [...ext.slice(k), ...ext.slice(0, k)] : ext;
    const body = spread(rotated, 14, variant);
    // Close on a couple of the big rooms, so the reel still says "and inside".
    const rooms = ordered.filter((p) => ["salon", "master stateroom", "on deck master stateroom", "galley"].indexOf(lc(p.category)) >= 0);
    return uniq([...body, ...rooms.slice(0, 2)]).slice(0, 16);
  }

  if (angle === "inside") {
    const inside = ordered.filter((p) => !isExterior(p.category) && !isRunningOrAerial(p.category) && !isDetail(p.category) && lc(p.category) !== "other" && isInside(p.category));
    if (inside.length < MIN_ANGLE_PHOTOS) return null;
    const first = opener(inside);
    return uniq([first, ...spread(inside, 17, variant)]);
  }

  // details
  const details = ordered.filter((p) => isDetail(p.category));
  if (details.length < MIN_ANGLE_PHOTOS - 2) return null;
  const first = opener(details);
  const body = spread(details, 15, variant);
  // Top up with exterior so a short list still makes a reel.
  const topUp = body.length < 12 ? exteriors.filter((p) => p.id !== first.id && body.indexOf(p) < 0).slice(0, 12 - body.length) : [];
  return uniq([first, ...body, ...topUp]);
}

// ── Look choice ──────────────────────────────────────────────────────────────

const LOOK_PREFERENCE: Record<ReelServiceAngle, StyleKey[]> = {
  full_tour: ["marquee", "underway", "cinematic", "walkthrough", "stack_underway", "energy", "stack"],
  underway_exterior: ["underway", "energy", "marquee", "cinematic", "stack", "walkthrough", "stack_underway"],
  inside: ["walkthrough", "cinematic", "marquee", "stack_underway", "underway", "energy", "stack"],
  details: ["stack", "energy", "marquee", "cinematic", "stack_underway", "underway", "walkthrough"],
};

export function chooseLook(angle: ReelServiceAngle, opts: { avoid: StyleKey[]; preferClips: boolean; skip?: StyleKey[] }): StyleKey {
  let prefs = LOOK_PREFERENCE[angle].slice();
  // With clips to show, the looks that play them go first.
  if (opts.preferClips) prefs = [...prefs.filter(lookPlaysClips), ...prefs.filter((k) => !lookPlaysClips(k))];
  const skip = opts.skip ?? [];
  const hit = prefs.find((k) => opts.avoid.indexOf(k) < 0 && skip.indexOf(k) < 0);
  if (hit) return hit;
  return prefs.find((k) => skip.indexOf(k) < 0) ?? prefs[0];
}

// ── Clips ────────────────────────────────────────────────────────────────────

const IN_FRACS = [0.35, 0.6, 0.15, 0.8, 0.5, 0.25, 0.7];
const CLIPS_FOR: Record<ReelServiceAngle, number> = { underway_exterior: REEL_SERVICE_CLIP_MAX, full_tour: 3, inside: 2, details: 2 };

export function chooseClips(videos: VideoRow[], angle: ReelServiceAngle, look: StyleKey, usedSoFar: number): ReelServiceClip[] {
  if (!lookPlaysClips(look) || videos.length === 0) return [];
  const n = Math.min(CLIPS_FOR[angle], REEL_SERVICE_CLIP_MAX, Math.max(videos.length, angle === "underway_exterior" ? 3 : 1));
  const out: ReelServiceClip[] = [];
  for (let i = 0; i < n; i++) {
    const vi = (usedSoFar + i) % videos.length;
    // Second time round the same video: a different moment of it.
    const lap = Math.floor((usedSoFar + i) / videos.length);
    out.push({
      videoId: videos[vi].id,
      inFrac: IN_FRACS[(usedSoFar + i + lap * 2) % IN_FRACS.length],
      lengthSec: angle === "underway_exterior" ? 4 : 3,
    });
  }
  return out;
}

/** Clips threaded through the photos: one after every few, never first. */
export function interleave(photoIds: string[], clipCount: number): string[] {
  if (clipCount === 0) return photoIds.slice();
  const out: string[] = [];
  const gap = Math.max(2, Math.floor(photoIds.length / (clipCount + 1)));
  let c = 0;
  for (let i = 0; i < photoIds.length; i++) {
    out.push(photoIds[i]);
    if (c < clipCount && i >= 1 && (i + 1) % gap === 0) out.push(`clip:${c++}`);
  }
  while (c < clipCount) out.push(`clip:${c++}`);
  return out;
}

// ── Caption ──────────────────────────────────────────────────────────────────

/**
 * The caption's second line, by angle. A listing can get the same angle more
 * than once in a month (an angle without the photos falls back to Full tour),
 * so each angle has several lines and the variant picks one.
 */
const ANGLE_LINES: Record<ReelServiceAngle, string[]> = {
  full_tour: [
    "A complete walkthrough, bow to stern.",
    "The full tour, deck by deck.",
    "Everything aboard, in under a minute.",
    "Take the tour, from the swim platform up.",
  ],
  underway_exterior: [
    "Underway and on deck.",
    "Out on the water, where she belongs.",
    "Running shots and the decks that matter.",
  ],
  inside: [
    "Step inside: the salon, the galley and the staterooms.",
    "The interior, room by room.",
    "Where the guests live aboard.",
  ],
  details: [
    "The details that matter, from the helm to the engine room.",
    "Helm, cockpit and machinery, up close.",
    "A closer look at how she\u2019s kept.",
  ],
};

function tag(s: string | null | undefined): string | null {
  const t = (s ?? "").replace(/[^a-z0-9]+/gi, " ").trim().split(/\s+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  return t ? `#${t}` : null;
}

export function reelServiceCaption(l: Pick<ListingRow, "year" | "length_ft" | "make" | "model" | "vessel_name" | "location" | "vessel_type">, angle: ReelServiceAngle, variant = 0): string {
  const len = l.length_ft ? `${Math.round(Number(l.length_ft))}'` : null;
  const boat = [l.year, len, l.make, l.model].filter(Boolean).join(" ");
  const name = l.vessel_name ? `“${l.vessel_name}”` : null;
  const first = [boat || null, name, "for sale"].filter(Boolean).join(" ") + (l.location ? ` in ${l.location}` : "");
  const city = (l.location ?? "").split(",")[0];
  const tags = uniq([
    "#YachtForSale",
    tag(l.make),
    tag(city),
    l.vessel_type ? tag(l.vessel_type) : null,
    "#Yachting",
  ].filter((x): x is string => !!x)).slice(0, 5);
  const lines = ANGLE_LINES[angle];
  const closers = ["Message me for the full listing or a private showing.", "Ask me for the brochure or a showing.", "DM for details or to arrange a viewing."];
  return `${first}.\n${lines[variant % lines.length]} ${closers[variant % closers.length]}\n\n${tags.join(" ")}`;
}

// ── The planner ──────────────────────────────────────────────────────────────

type JobRow = {
  id: string; broker_id: string; listing_id: string; period: string; slot: number;
  angle: string; look: string; status: string; settings: ReelServiceSettings | null;
};

type ListingPack = { listing: ListingRow; ordered: PhotoRow[]; videos: VideoRow[] };

async function loadListingPacks(admin: SupabaseClient, brokerId: string): Promise<ListingPack[]> {
  const { data: listings } = await admin.from("listings")
    .select("id, broker_id, vessel_name, vessel_type, year, make, model, length_ft, location, hero_photo_id, photo_order_manual, created_at")
    .eq("broker_id", brokerId).eq("status", "active");
  const rows = (listings ?? []) as ListingRow[];
  if (rows.length === 0) return [];
  const ids = rows.map((l) => l.id);
  const [{ data: photos }, { data: videos }] = await Promise.all([
    admin.from("photos").select("id, listing_id, category, display_order").in("listing_id", ids).eq("is_visible", true),
    admin.from("videos").select("id, listing_id, display_order").in("listing_id", ids).order("display_order"),
  ]);
  const out: ListingPack[] = [];
  rows.forEach((l) => {
    const ph = ((photos ?? []) as (PhotoRow & { listing_id: string })[]).filter((p) => p.listing_id === l.id);
    if (ph.length < MIN_LISTING_PHOTOS) return;
    const ordered = orderPhotos(ph, { manual: l.photo_order_manual === true, heroId: l.hero_photo_id });
    const vids = ((videos ?? []) as (VideoRow & { listing_id: string })[]).filter((v) => v.listing_id === l.id);
    out.push({ listing: l, ordered, videos: vids });
  });
  return out;
}

type PlanContext = {
  /** All of this broker's jobs, every period. */
  history: JobRow[];
  period: string;
};

/** Build one job's plan for a listing, given what's already planned. */
function planOne(pack: ListingPack, ctx: PlanContext, opts: { excludeJobId?: string; forceLook?: StyleKey; bump?: number } = {}) {
  const { listing, ordered, videos } = pack;
  const others = ctx.history.filter((j) => j.id !== opts.excludeJobId);
  const onListingEver = others.filter((j) => j.listing_id === listing.id);
  const onListingThisMonth = onListingEver.filter((j) => j.period === ctx.period);
  const lastMonth = onListingEver.filter((j) => j.period === previousPeriod(ctx.period));
  const looksThisMonth = onListingThisMonth.map((j) => j.look as StyleKey);
  // The listing's first reel ever (slot 1 of its first month) is its launch.
  const launch = onListingEver.length === 0;

  // Angle: the ones this listing hasn't had this month, in order — so four
  // reels take all four angles where the photos allow it.
  const usedAngles = onListingThisMonth.map((j) => j.angle);
  let candidates: ReelServiceAngle[] = launch
    ? ["full_tour"]
    : REEL_SERVICE_ANGLES.filter((a) => usedAngles.indexOf(a) < 0);
  if (candidates.length === 0) candidates = REEL_SERVICE_ANGLES.slice();
  if (opts.bump && candidates.length > 1) {
    const k = opts.bump % candidates.length;
    candidates = [...candidates.slice(k), ...candidates.slice(0, k)];
  }

  let angle: ReelServiceAngle = "full_tour";
  let picked: PhotoRow[] | null = null;
  // How many reels of this angle this listing has already had (this month
  // included) — the variant, so a repeat takes a different subset and opener.
  const variantOf = (a: ReelServiceAngle) => onListingEver.filter((j) => j.angle === a).length + (opts.bump ?? 0);
  for (let i = 0; i < candidates.length; i++) {
    const got = photosForAngle(ordered, candidates[i], variantOf(candidates[i]), listing.hero_photo_id);
    if (got && got.length >= MIN_ANGLE_PHOTOS - 2) { angle = candidates[i]; picked = got; break; }
  }
  if (!picked) {
    // Not enough of any remaining angle: another Full tour — a different
    // subset (the variant) and, below, a different look.
    angle = "full_tour";
    picked = photosForAngle(ordered, "full_tour", variantOf("full_tour"), listing.hero_photo_id) ?? ordered.slice(0, 18);
  }
  const variant = variantOf(angle);

  // Look: never one this listing already has this month; prefer not to repeat
  // last month's look on the same angle, then not last month's looks at all.
  const lastSameAngle = lastMonth.filter((j) => j.angle === angle).map((j) => j.look as StyleKey);
  const lastAll = lastMonth.map((j) => j.look as StyleKey);
  const preferClips = videos.length > 0;
  let look: StyleKey;
  if (opts.forceLook) {
    look = opts.forceLook;
  } else {
    // With videos on the listing, a look that plays clips beats avoiding
    // last month's other looks (but never beats this month's or last month's
    // same angle+look).
    const tiers: { avoid: StyleKey[]; needClips: boolean }[] = [
      { avoid: uniq([...looksThisMonth, ...lastSameAngle, ...lastAll]), needClips: preferClips },
      { avoid: uniq([...looksThisMonth, ...lastSameAngle]), needClips: preferClips },
      { avoid: uniq([...looksThisMonth, ...lastSameAngle]), needClips: false },
      { avoid: looksThisMonth, needClips: false },
    ];
    look = chooseLook(angle, { avoid: [], preferClips, skip: looksThisMonth });
    for (let t = 0; t < tiers.length; t++) {
      const k = chooseLook(angle, { avoid: tiers[t].avoid, preferClips });
      if (tiers[t].avoid.indexOf(k) < 0 && (!tiers[t].needClips || lookPlaysClips(k))) { look = k; break; }
    }
  }

  // Clips: rotate through the listing's videos (and moments in them) across
  // the month, counting what this month's other reels already used.
  const clipsUsed = onListingThisMonth.reduce((a, j) => a + (j.settings?.clips?.length ?? 0), 0) + (opts.bump ?? 0);
  const clips = chooseClips(videos, angle, look, clipsUsed);
  const photoIds = picked.map((p) => p.id);
  const settings: ReelServiceSettings = {
    order: interleave(photoIds, clips.length),
    photoIds,
    clips,
    // Short caps at 12 items and ~25s; with clips (their seconds come out of
    // the budget first) or more photos, Full.
    length: photoIds.length <= 10 && clips.length === 0 ? "short" : "full",
    fit: "whole",
    showPrice: true,
    showLocation: true,
    variant,
    ...(launch ? { launch: true } : {}),
  };
  return { angle, look, settings, caption: reelServiceCaption(listing, angle, variant) };
}

export type PlanResult = { brokers: number; listings: number; created: number; skipped: { brokerId: string; reason: string }[] };

/**
 * Plan a month. For every enabled subscription (or just `brokerIds`), and
 * every active listing of that broker with enough photos, make sure the
 * listing has `reels_per_listing` jobs for `period` — creating only the
 * missing ones (so a listing that goes active mid-month gets its full set).
 * Safe to run any number of times.
 */
export async function planReelServiceMonth(
  admin: SupabaseClient,
  period: string,
  opts: { brokerIds?: string[] } = {},
): Promise<PlanResult> {
  let q = admin.from("reel_service_subscriptions").select("broker_id, reels_per_listing").eq("enabled", true);
  if (opts.brokerIds && opts.brokerIds.length) q = q.in("broker_id", opts.brokerIds);
  const { data: subs, error } = await q;
  if (error) throw new Error(error.message);

  const result: PlanResult = { brokers: 0, listings: 0, created: 0, skipped: [] };
  for (const sub of (subs ?? []) as { broker_id: string; reels_per_listing: number }[]) {
    result.brokers++;
    const perListing = Math.max(1, Math.min(10, sub.reels_per_listing ?? 4));
    const packs = await loadListingPacks(admin, sub.broker_id);
    if (packs.length === 0) {
      result.skipped.push({ brokerId: sub.broker_id, reason: `No active listing with ${MIN_LISTING_PHOTOS}+ photos.` });
      continue;
    }
    const { data: hist } = await admin.from("reel_service_jobs")
      .select("id, broker_id, listing_id, period, slot, angle, look, status, settings")
      .in("listing_id", packs.map((p) => p.listing.id));
    const ctx: PlanContext = { history: ((hist ?? []) as JobRow[]).slice(), period };

    for (const pack of packs) {
      result.listings++;
      const current = ctx.history.filter((j) => j.listing_id === pack.listing.id && j.period === period);
      const missing = Math.max(0, perListing - current.length);
      let nextSlot = current.reduce((m, j) => Math.max(m, j.slot), 0) + 1;
      for (let s = 0; s < missing; s++) {
        const plan = planOne(pack, ctx);
        const row = {
          broker_id: sub.broker_id,
          listing_id: pack.listing.id,
          period,
          slot: nextSlot,
          angle: plan.angle,
          look: plan.look,
          settings: plan.settings,
          caption: plan.caption,
          status: "planned" as const,
        };
        const { data: ins, error: insErr } = await admin.from("reel_service_jobs").insert(row).select("id").single();
        if (insErr || !ins) {
          // A unique (listing, period, slot) clash means another run got here
          // first — stop for this listing rather than double-planning.
          result.skipped.push({ brokerId: sub.broker_id, reason: `${pack.listing.vessel_name ?? pack.listing.id}: ${insErr?.message ?? "insert failed"}` });
          break;
        }
        ctx.history.push({ ...row, id: ins.id as string });
        nextSlot++;
        result.created++;
      }
    }
  }
  return result;
}

/**
 * Re-plan one job: a different angle/photo variant and (unless `look` is
 * given) a fresh look. Delivered jobs are left alone. Returns the new plan.
 */
export async function replanReelServiceJob(
  admin: SupabaseClient,
  jobId: string,
  opts: { look?: StyleKey } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: job } = await admin.from("reel_service_jobs")
    .select("id, broker_id, listing_id, period, slot, angle, look, status, settings").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, error: "Job not found." };
  if (job.status === "delivered") return { ok: false, error: "Already delivered." };
  const { data: hist } = await admin.from("reel_service_jobs")
    .select("id, broker_id, listing_id, period, slot, angle, look, status, settings").eq("listing_id", job.listing_id);
  const packs = await loadListingPacks(admin, job.broker_id);
  const pack = packs.find((p) => p.listing.id === job.listing_id);
  if (!pack) return { ok: false, error: "This listing is no longer active or has too few photos to plan." };
  const ctx: PlanContext = { history: (hist ?? []) as JobRow[], period: job.period };
  const bump = 1 + Math.floor(Math.random() * 5);
  const plan = planOne(pack, ctx, { excludeJobId: job.id, forceLook: opts.look, bump });
  // A re-plan should change the look too, unless one was asked for.
  if (!opts.look && plan.look === job.look) {
    const taken = ((hist ?? []) as JobRow[])
      .filter((j) => j.id !== job.id && j.period === job.period)
      .map((j) => j.look as StyleKey)
      .concat([job.look as StyleKey]);
    plan.look = chooseLook(plan.angle as ReelServiceAngle, { avoid: taken, preferClips: pack.videos.length > 0, skip: [job.look as StyleKey] });
    plan.settings.clips = chooseClips(pack.videos, plan.angle as ReelServiceAngle, plan.look, bump);
    plan.settings.order = interleave(plan.settings.photoIds, plan.settings.clips.length);
  }
  const { error } = await admin.from("reel_service_jobs").update({
    angle: plan.angle,
    look: plan.look,
    settings: plan.settings,
    caption: plan.caption,
    status: "planned",
    error: null,
  }).eq("id", job.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Change only the look. Clips are re-chosen when the new look plays them and
 * the old one didn't (or the reverse), so the settings stay honest.
 */
export async function setReelServiceJobLook(admin: SupabaseClient, jobId: string, look: StyleKey): Promise<{ ok: true } | { ok: false; error: string }> {
  if (REEL_SERVICE_LOOKS.indexOf(look) < 0 && !REEL_STYLES[look]) return { ok: false, error: "Unknown look." };
  const { data: job } = await admin.from("reel_service_jobs").select("id, listing_id, angle, status, settings").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, error: "Job not found." };
  if (job.status === "delivered") return { ok: false, error: "Already delivered." };
  const settings = (job.settings ?? {}) as ReelServiceSettings;
  if (lookPlaysClips(look) && (!settings.clips || settings.clips.length === 0)) {
    const { data: vids } = await admin.from("videos").select("id, display_order").eq("listing_id", job.listing_id).order("display_order");
    settings.clips = chooseClips((vids ?? []) as VideoRow[], job.angle as ReelServiceAngle, look, settings.variant ?? 0);
    settings.order = interleave(settings.photoIds ?? [], settings.clips.length);
    if (settings.clips.length > 0) settings.length = "full";
  }
  const { error } = await admin.from("reel_service_jobs").update({ look, settings, status: "planned", error: null }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
