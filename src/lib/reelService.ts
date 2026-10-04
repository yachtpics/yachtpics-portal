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

/** The looks the service rotates through for photo-led reels — the strong social ones. */
export const REEL_SERVICE_LOOKS: StyleKey[] = ["underway", "marquee", "cinematic", "walkthrough", "energy", "stack", "stack_underway"];

/**
 * Looks for VIDEO-LED reels (Oct 4, Charlie: "more video than photos"). Only
 * single-frame looks that play clips full frame: never Stack / Stack Underway
 * (no clips) nor the Marquee pair (clips only in the bottom band).
 */
export const VIDEO_LED_LOOKS: StyleKey[] = ["underway", "cinematic", "walkthrough", "energy", "editorial", "classic"];

/** Stack and Stack Underway play no clips (ReelMaker leaves them out). */
export function lookPlaysClips(look: StyleKey): boolean {
  return REEL_STYLES[look]?.layout !== "stack";
}

/** Whether a look can carry a video-led reel (clips full frame). */
export function lookIsVideoLed(look: StyleKey): boolean {
  return VIDEO_LED_LOOKS.indexOf(look) >= 0 || (lookPlaysClips(look) && REEL_STYLES[look]?.layout !== "marquee");
}

/** A listing needs at least this many visible photos to be planned at all. */
export const MIN_LISTING_PHOTOS = 8;
/** An angle needs this many photos of its own kind, or it falls back to Full tour. */
const MIN_ANGLE_PHOTOS = 8;

/**
 * One cut from a listing video. `inFrac` is where it starts as a fraction of
 * the video; `inSec` the same in seconds when the video's length was known at
 * planning time (null otherwise — the renderer measures the video and uses
 * inFrac). `durSec` is 2–4 s.
 */
export type ReelServiceSegment = { videoId: string; inFrac: number; inSec: number | null; durSec: 2 | 3 | 4 };

/**
 * Everything ReelMaker needs to render a job. `order` is the play order:
 * photo ids, and "clip:N" for segments[N].
 */
export type ReelServiceSettings = {
  order: string[];
  photoIds: string[];
  segments: ReelServiceSegment[];
  length: "short" | "full" | "long";
  fit: "whole" | "fill";
  showPrice: boolean;
  showLocation: boolean;
  variant: number;
  /** The listing's very first reel (slot 1 of its first month): a Full tour. */
  launch?: boolean;
  /** Video-led: opens on a segment, mostly video, photos as beats. */
  videoLed: boolean;
  /** Seconds of video on the listing that have been measured (null: none measured). */
  footageSec: number | null;
  /** Listing videos whose length isn't known yet. */
  unmeasuredVideos: number;
  /** Under VIDEO_LED_MIN_FOOTAGE of usable footage: planned photo-led, flagged on the board. */
  needsMoreVideo: boolean;
  /** Estimates for the board. */
  estVideoSec: number;
  estPhotoSec: number;
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
export type VideoRow = {
  id: string; display_order: number | null; duration_sec?: number | null;
  title?: string | null; filename?: string | null; description?: string | null;
};
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

const VIDEO_LOOK_PREFERENCE: Record<ReelServiceAngle, StyleKey[]> = {
  full_tour: ["cinematic", "underway", "walkthrough", "editorial", "energy", "classic"],
  underway_exterior: ["underway", "energy", "cinematic", "editorial", "walkthrough", "classic"],
  inside: ["walkthrough", "cinematic", "editorial", "underway", "classic", "energy"],
  details: ["energy", "editorial", "cinematic", "classic", "underway", "walkthrough"],
};

export function chooseLook(
  angle: ReelServiceAngle,
  opts: { avoid: StyleKey[]; preferClips: boolean; skip?: StyleKey[]; videoLed?: boolean },
): StyleKey {
  let prefs = (opts.videoLed ? VIDEO_LOOK_PREFERENCE : LOOK_PREFERENCE)[angle].slice();
  // With clips to show, the looks that play them go first.
  if (opts.preferClips) prefs = [...prefs.filter(lookPlaysClips), ...prefs.filter((k) => !lookPlaysClips(k))];
  const skip = opts.skip ?? [];
  const hit = prefs.find((k) => opts.avoid.indexOf(k) < 0 && skip.indexOf(k) < 0);
  if (hit) return hit;
  return prefs.find((k) => skip.indexOf(k) < 0) ?? prefs[0];
}

// ── Video segments ───────────────────────────────────────────────────────────

/** Below this much usable footage a listing is planned photo-led and flagged. */
export const VIDEO_LED_MIN_FOOTAGE = 20;
/** A video whose length isn't known yet is planned as if it were this long. */
const ASSUMED_VIDEO_SEC = 90;
/** Skip the first and last 5% of every video (slates, fades, the drone taking off). */
const EDGE = 0.05;
/** Segments per reel, at most (ReelMaker shares one source per video, so this is cheap). */
export const MAX_SEGMENTS = 14;
/** Room each segment needs in its slice of the video (its length + a gap). */
const SEG_ROOM = 4.5;
const SEG_PATTERN: (2 | 3 | 4)[] = [3, 2, 3, 4, 2, 3, 3, 2, 4, 3, 2, 3, 4, 2];
/** Clips in a PHOTO-led reel, by angle (as before). */
const PHOTO_LED_SEGMENTS: Record<ReelServiceAngle, number> = { underway_exterior: 4, full_tour: 3, inside: 2, details: 2 };

const EXTERIOR_WORDS = /(running|underway|aerial|drone|exterior|profile|cruis|sea ?trial|outside|on the water|helicopter)/i;
const INTERIOR_WORDS = /(interior|inside|walk ?-?through|salon|saloon|cabin|stateroom|galley)/i;

const videoText = (v: VideoRow) => `${v.title ?? ""} ${v.filename ?? ""} ${v.description ?? ""}`;
const durOf = (v: VideoRow) => (v.duration_sec && v.duration_sec > 0 ? Number(v.duration_sec) : null);

/** Measured footage on a listing: usable seconds (edges trimmed) and how many videos are unmeasured. */
export function footageOf(videos: VideoRow[]): { measuredSec: number | null; usableSec: number; unmeasured: number; effectiveSec: number } {
  let measured = 0, anyMeasured = false, usable = 0, unmeasured = 0;
  videos.forEach((v) => {
    const d = durOf(v);
    if (d === null) { unmeasured++; return; }
    anyMeasured = true;
    measured += d;
    usable += d * (1 - 2 * EDGE);
  });
  return {
    measuredSec: anyMeasured ? Math.round(measured) : null,
    usableSec: usable,
    unmeasured,
    // What the planner can count on: measured footage, plus an assumed length
    // for each unmeasured video (most listings carry one 1–3 minute walkthrough).
    effectiveSec: usable + unmeasured * ASSUMED_VIDEO_SEC * (1 - 2 * EDGE),
  };
}

/** Where in a video an angle looks when the videos aren't titled (walkthroughs usually start outside). */
const ANGLE_WINDOW: Record<ReelServiceAngle, [number, number]> = {
  full_tour: [EDGE, 1 - EDGE],
  underway_exterior: [EDGE, 0.5],
  inside: [0.35, 1 - EDGE],
  details: [EDGE, 1 - EDGE],
};

/** A repeatable 0–1 number for (seed, i): golden-ratio steps, so offsets spread. */
const frac01 = (seed: number, i: number) => {
  const x = 0.5 + seed * 0.6180339887 + i * 0.3819660113;
  return x - Math.floor(x);
};

/**
 * Cut `targetSec` of segments (2–4 s each, up to MAX_SEGMENTS) out of a
 * listing's videos for one reel.
 *
 * - Every video's first and last 5% are skipped; an angle can narrow that to
 *   the part of an untitled walkthrough it suits (first half for Underway &
 *   exterior, later part for Inside), widened again if it's too short.
 * - Titled videos steer the angle: "running/aerial/drone…" for Underway &
 *   exterior, "interior/walkthrough…" for Inside, when they have enough.
 * - Segments are shared out between videos by usable length; within a video
 *   its window is cut into equal slices, one segment per slice, placed at an
 *   offset set by `seed` — so segments never overlap within a reel, and a
 *   different seed (another reel of the month) lands on different moments.
 * - Returned in play order: chronological within a video, videos taken in
 *   turn; the first is the hook (a 4 s segment, from the preferred video).
 */
export function chooseSegments(videos: VideoRow[], angle: ReelServiceAngle, targetSec: number, seed: number, maxCount = MAX_SEGMENTS): ReelServiceSegment[] {
  const pool = videos
    .map((v) => ({ v, dur: durOf(v) ?? ASSUMED_VIDEO_SEC, known: durOf(v) !== null }))
    .filter((x) => x.dur >= 6);
  if (pool.length === 0 || targetSec <= 0 || maxCount <= 0) return [];

  const re = angle === "underway_exterior" ? EXTERIOR_WORDS : angle === "inside" ? INTERIOR_WORDS : null;
  const preferred = re ? pool.filter((x) => re.test(videoText(x.v))) : [];
  const usable = (x: { dur: number }) => x.dur * (1 - 2 * EDGE);
  const prefUsable = preferred.reduce((a, x) => a + usable(x), 0);
  const titled = preferred.length > 0 && prefUsable >= targetSec * 1.2;
  const cand = titled ? preferred : pool;

  // Each video's window.
  let windows = cand.map((x) => (titled ? [EDGE, 1 - EDGE] : ANGLE_WINDOW[angle]) as [number, number]);
  const cap = (w: [number, number], dur: number) => Math.floor(((w[1] - w[0]) * dur) / SEG_ROOM);
  // Lengths, rotated by the seed so reels differ in rhythm too.
  const lens: (2 | 3 | 4)[] = [];
  let total = 0;
  for (let i = 0; i < maxCount && total < targetSec; i++) {
    const l = i === 0 ? 4 : SEG_PATTERN[(i + seed) % SEG_PATTERN.length];
    lens.push(l);
    total += l;
  }
  let capacity = cand.reduce((a, x, i) => a + cap(windows[i], x.dur), 0);
  if (capacity < lens.length) {
    windows = cand.map(() => [EDGE, 1 - EDGE] as [number, number]);
    capacity = cand.reduce((a, x, i) => a + cap(windows[i], x.dur), 0);
  }
  while (lens.length > capacity) lens.pop();
  if (lens.length === 0) return [];

  // Share the segments out by usable length (largest remainder), within capacity.
  const weights = cand.map((x, i) => (windows[i][1] - windows[i][0]) * x.dur);
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  const counts = weights.map((w, i) => Math.min(cap(windows[i], cand[i].dur), Math.floor((w / wsum) * lens.length)));
  let left = lens.length - counts.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => ({ i, r: (w / wsum) * lens.length - Math.floor((w / wsum) * lens.length) })).sort((a, b) => b.r - a.r);
  for (let pass = 0; left > 0 && pass < 4; pass++) {
    for (let k = 0; k < order.length && left > 0; k++) {
      const i = order[k].i;
      if (counts[i] < cap(windows[i], cand[i].dur)) { counts[i]++; left--; }
    }
  }

  // Play order: videos in turn (the preferred/first video leads), each chronological.
  const playVideo: number[] = [];
  const remaining = counts.slice();
  while (playVideo.length < lens.length - Math.max(0, left)) {
    let moved = false;
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i] > 0) { playVideo.push(i); remaining[i]--; moved = true; }
    }
    if (!moved) break;
  }
  // Lengths in play order; each video's own lengths, in its chronological order.
  const perVideoLens: (2 | 3 | 4)[][] = cand.map(() => []);
  playVideo.forEach((vi, n) => perVideoLens[vi].push(lens[n]));
  const placed: ReelServiceSegment[][] = cand.map((x, vi) => {
    const L = perVideoLens[vi];
    const k = L.length;
    if (k === 0) return [];
    const [a, b] = windows[vi];
    const w0 = a * x.dur, slice = ((b - a) * x.dur) / k;
    return L.map((len, i) => {
      const slack = Math.max(0, slice - len - 0.4);
      const start = w0 + i * slice + frac01(seed + vi * 3, i) * slack;
      return {
        videoId: x.v.id,
        inFrac: Math.round((start / x.dur) * 10000) / 10000,
        inSec: x.known ? Math.round(start * 10) / 10 : null,
        durSec: len,
      };
    });
  });
  const cursor = cand.map(() => 0);
  return playVideo.map((vi) => placed[vi][cursor[vi]++]).filter(Boolean);
}

/**
 * Photo-led order (as before): photos in order, clips threaded through after
 * every few, never first.
 */
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

/**
 * Video-led order: open on the first segment (the hook — the title is drawn
 * over it), then mostly video with a photo beat every two or three segments,
 * spread evenly; no photo before the second segment.
 */
export function videoLedOrder(photoIds: string[], segCount: number): string[] {
  const out: string[] = [];
  const np = photoIds.length;
  // Photo j goes after segment pos[j] (1-based count of segments before it).
  const pos = photoIds.map((_, j) => Math.max(2, Math.round(((j + 1) * segCount) / (np + 1))));
  let pj = 0;
  for (let i = 0; i < segCount; i++) {
    out.push(`clip:${i}`);
    while (pj < np && pos[pj] <= i + 1) out.push(photoIds[pj++]);
  }
  while (pj < np) out.push(photoIds[pj++]);
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

export const VIDEO_SELECT = "id, listing_id, display_order, duration_sec, title, filename, description";

async function loadListingPacks(admin: SupabaseClient, brokerId: string): Promise<ListingPack[]> {
  const { data: listings } = await admin.from("listings")
    .select("id, broker_id, vessel_name, vessel_type, year, make, model, length_ft, location, hero_photo_id, photo_order_manual, created_at")
    .eq("broker_id", brokerId).eq("status", "active");
  const rows = (listings ?? []) as ListingRow[];
  if (rows.length === 0) return [];
  const ids = rows.map((l) => l.id);
  const [{ data: photos }, { data: videos }] = await Promise.all([
    admin.from("photos").select("id, listing_id, category, display_order").in("listing_id", ids).eq("is_visible", true),
    admin.from("videos").select(VIDEO_SELECT).in("listing_id", ids).order("display_order"),
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
  /** All jobs on the listings being planned, every period. */
  history: JobRow[];
  period: string;
};

/** Photo beats in a video-led reel: about one per seven seconds of video, 3–5. */
function photoBeats(videoSec: number): number {
  return Math.max(3, Math.min(5, Math.round(videoSec / 7)));
}

/**
 * The segments, order and estimates for a job, given its angle, look and
 * photos. Shared by the planner and "Change look".
 */
function buildMedia(
  videos: VideoRow[],
  angle: ReelServiceAngle,
  look: StyleKey,
  picked: string[],
  seed: number,
  variant: number,
): Pick<ReelServiceSettings, "order" | "photoIds" | "segments" | "length" | "videoLed" | "footageSec" | "unmeasuredVideos" | "needsMoreVideo" | "estVideoSec" | "estPhotoSec"> {
  const f = footageOf(videos);
  const enough = videos.length > 0 && f.effectiveSec >= VIDEO_LED_MIN_FOOTAGE;
  const videoLed = enough && lookIsVideoLed(look);
  const base = {
    footageSec: f.measuredSec,
    unmeasuredVideos: f.unmeasured,
    needsMoreVideo: !enough,
  };
  if (videoLed) {
    // ~28–32 s of video (never more than ~90% of what there is), which with
    // the photo beats and the end card lands at ~40–48 s, ≥60% video.
    const target = Math.min(28 + (variant % 3) * 2, Math.max(16, f.effectiveSec * 0.9));
    const segments = chooseSegments(videos, angle, target, seed);
    const videoSec = segments.reduce((a, x) => a + x.durSec, 0);
    if (segments.length >= 3) {
      const photoIds = spreadIds(picked, photoBeats(videoSec), variant);
      return {
        ...base,
        videoLed: true,
        segments,
        photoIds,
        order: videoLedOrder(photoIds, segments.length),
        length: "full",
        estVideoSec: videoSec,
        estPhotoSec: Math.round(photoIds.length * 1.5 * 10) / 10,
      };
    }
  }
  // Photo-led (as before): the angle's photos, a few clips threaded through.
  const segments = lookPlaysClips(look) && videos.length > 0
    ? chooseSegments(videos, angle, PHOTO_LED_SEGMENTS[angle] * 3, seed, PHOTO_LED_SEGMENTS[angle])
    : [];
  const videoSec = segments.reduce((a, x) => a + x.durSec, 0);
  return {
    ...base,
    videoLed: false,
    segments,
    photoIds: picked,
    order: interleave(picked, segments.length),
    // Short caps at 12 items and ~25s; with clips or more photos, Full.
    length: picked.length <= 10 && segments.length === 0 ? "short" : "full",
    estVideoSec: videoSec,
    estPhotoSec: Math.round((4.2 + Math.max(0, picked.length - 1) * 1.7) * 10) / 10,
  };
}

/** `n` ids spread through a list (keeps order; the first stays first). */
function spreadIds(ids: string[], n: number, variant: number): string[] {
  if (ids.length <= n) return ids.slice();
  return uniq([ids[0], ...spread(ids.slice(1), n - 1, variant)]).slice(0, n);
}

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

  // Video-led when the listing has the footage: only clip-playing,
  // full-frame looks are in the running.
  const videoLedPossible = videos.length > 0 && footageOf(videos).effectiveSec >= VIDEO_LED_MIN_FOOTAGE;

  // Look: never one this listing already has this month; prefer not to repeat
  // last month's look on the same angle, then not last month's looks at all.
  const lastSameAngle = lastMonth.filter((j) => j.angle === angle).map((j) => j.look as StyleKey);
  const lastAll = lastMonth.map((j) => j.look as StyleKey);
  const preferClips = videos.length > 0;
  let look: StyleKey;
  if (opts.forceLook) {
    look = opts.forceLook;
  } else {
    const pick = (avoid: StyleKey[]) => chooseLook(angle, { avoid, preferClips, videoLed: videoLedPossible });
    const tiers: { avoid: StyleKey[]; needClips: boolean }[] = [
      { avoid: uniq([...looksThisMonth, ...lastSameAngle, ...lastAll]), needClips: preferClips },
      { avoid: uniq([...looksThisMonth, ...lastSameAngle]), needClips: preferClips },
      { avoid: uniq([...looksThisMonth, ...lastSameAngle]), needClips: false },
      { avoid: looksThisMonth, needClips: false },
    ];
    look = chooseLook(angle, { avoid: [], preferClips, skip: looksThisMonth, videoLed: videoLedPossible });
    for (let t = 0; t < tiers.length; t++) {
      const k = pick(tiers[t].avoid);
      if (tiers[t].avoid.indexOf(k) < 0 && (!tiers[t].needClips || lookPlaysClips(k))) { look = k; break; }
    }
  }

  // Segments: a different seed for every reel of the listing (its running
  // count), so the month's reels land on different moments of the footage.
  const seed = onListingEver.length + (opts.bump ?? 0) * 5;
  const media = buildMedia(videos, angle, look, picked.map((p) => p.id), seed, variant);
  const settings: ReelServiceSettings = {
    ...media,
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
 * New jobs take the lowest free slot numbers. Safe to run any number of times.
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
      const taken = current.map((j) => j.slot);
      for (let s = 0; s < missing; s++) {
        let slot = 1;
        while (taken.indexOf(slot) >= 0) slot++;
        taken.push(slot);
        const plan = planOne(pack, ctx);
        const row = {
          broker_id: sub.broker_id,
          listing_id: pack.listing.id,
          period,
          slot,
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
        result.created++;
      }
    }
  }
  return result;
}

/**
 * Throw away the not-yet-made jobs (planned / failed) of these listings for a
 * month and plan them again — used after measuring video lengths, so the
 * segments and the video-led decision use the real footage.
 */
export async function replanUnmade(admin: SupabaseClient, period: string, listingIds: string[]): Promise<PlanResult & { removed: number }> {
  if (listingIds.length === 0) return { brokers: 0, listings: 0, created: 0, skipped: [], removed: 0 };
  const { data: gone, error } = await admin.from("reel_service_jobs")
    .delete()
    .eq("period", period)
    .in("listing_id", listingIds)
    .in("status", ["planned", "failed"])
    .select("broker_id");
  if (error) throw new Error(error.message);
  const brokerIds = ((gone ?? []) as { broker_id: string }[]).map((g) => g.broker_id).filter((b, i, a) => a.indexOf(b) === i);
  const r = brokerIds.length ? await planReelServiceMonth(admin, period, { brokerIds }) : { brokers: 0, listings: 0, created: 0, skipped: [] };
  return { ...r, removed: (gone ?? []).length };
}

/**
 * Re-plan one job: a different angle/photo variant and (unless `look` is
 * given) a fresh look. Delivered jobs are left alone.
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
  let plan = planOne(pack, ctx, { excludeJobId: job.id, forceLook: opts.look, bump });
  // A re-plan should change the look too, unless one was asked for.
  if (!opts.look && plan.look === job.look) {
    const taken = ((hist ?? []) as JobRow[])
      .filter((j) => j.id !== job.id && j.period === job.period)
      .map((j) => j.look as StyleKey)
      .concat([job.look as StyleKey]);
    const videoLed = pack.videos.length > 0 && footageOf(pack.videos).effectiveSec >= VIDEO_LED_MIN_FOOTAGE;
    const other = chooseLook(plan.angle as ReelServiceAngle, { avoid: taken, preferClips: pack.videos.length > 0, skip: [job.look as StyleKey], videoLed });
    plan = planOne(pack, ctx, { excludeJobId: job.id, forceLook: other, bump });
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
 * Change only the look. The media is rebuilt for it (a video-led reel needs a
 * clip-playing, full-frame look; a look without clips gets none), keeping the
 * job's angle, photos and segment seed.
 */
export async function setReelServiceJobLook(admin: SupabaseClient, jobId: string, look: StyleKey): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!REEL_STYLES[look]) return { ok: false, error: "Unknown look." };
  const { data: job } = await admin.from("reel_service_jobs").select("id, listing_id, angle, status, settings").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, error: "Job not found." };
  if (job.status === "delivered") return { ok: false, error: "Already delivered." };
  const settings = (job.settings ?? {}) as ReelServiceSettings;
  const { data: vids } = await admin.from("videos").select(VIDEO_SELECT).eq("listing_id", job.listing_id).order("display_order");
  const videos = (vids ?? []) as VideoRow[];
  if (settings.videoLed && !lookIsVideoLed(look)) {
    return { ok: false, error: `${REEL_STYLES[look].name} can\u2019t lead with video (it plays no clips full frame). Pick ${VIDEO_LED_LOOKS.map((k) => REEL_STYLES[k].name).join(", ")}.` };
  }
  // The full photo pick for the angle isn't stored for video-led jobs (only
  // the beats), so the photos stay as they are; segments are rebuilt.
  const seed = (settings.variant ?? 0) * 7 + 3;
  const media = buildMedia(videos, job.angle as ReelServiceAngle, look, settings.photoIds ?? [], seed, settings.variant ?? 0);
  const next: ReelServiceSettings = { ...settings, ...media };
  const { error } = await admin.from("reel_service_jobs").update({ look, settings: next, status: "planned", error: null }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
