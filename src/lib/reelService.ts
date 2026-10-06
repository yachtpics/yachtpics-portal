import type { SupabaseClient } from "@supabase/supabase-js";
import { orderPhotos } from "@/lib/photoOrder";
import { isExterior, REEL_STYLES, type StyleKey } from "@/lib/reelStyles";
import { parseShotInfo } from "@/lib/reelClips";

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
 * Looks for VIDEO-LED reels (Oct 4, Charlie: "more video than photos";
 * Oct 6: no Energy — too abrupt; no Cinematic — its letterbox keeps video
 * out of the full frame. Cinematic stays for photo-led reels). Full-bleed,
 * soft-join looks whose video fills the 9:16 frame — exactly four, so a
 * listing's four reels a month each get one.
 */
export const VIDEO_LED_LOOKS: StyleKey[] = ["editorial", "walkthrough", "underway", "classic"];

/** Stack and Stack Underway play no clips (ReelMaker leaves them out). */
export function lookPlaysClips(look: StyleKey): boolean {
  return REEL_STYLES[look]?.layout !== "stack";
}

/** Whether a look can carry a video-led reel (clips full frame). */
export function lookIsVideoLed(look: StyleKey): boolean {
  return VIDEO_LED_LOOKS.indexOf(look) >= 0;
}

/** A listing needs at least this many visible photos to be planned at all. */
export const MIN_LISTING_PHOTOS = 8;
/** An angle needs this many photos of its own kind, or it falls back to Full tour. */
const MIN_ANGLE_PHOTOS = 8;

/**
 * One cut from a listing video. `inFrac` is where it starts as a fraction of
 * the video; `inSec` the same in seconds when the video's length was known at
 * planning time (null otherwise — the renderer measures the video and uses
 * inFrac). `durSec` is whole seconds: 4–6 on video-led reels (3 when cut down
 * to fit a short shot; 2–4 on reels planned before Oct 6).
 */
export type ReelServiceSegment = { videoId: string; inFrac: number; inSec: number | null; durSec: number };

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
  /** Video-led: every photo beat's hold, seconds (2–2.5). Null: the look's own. */
  photoHoldSec?: number | null;
  /** Video-led: crossfade into, out of and between segments, seconds. Null: the look's own. */
  clipJoinSec?: number | null;
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
  /** The video's shots ([start, end] s) when detected (videos.shot_cuts); null/absent = unknown. */
  shots?: [number, number][] | null;
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
  full_tour: ["walkthrough", "editorial", "underway", "classic"],
  underway_exterior: ["underway", "editorial", "walkthrough", "classic"],
  inside: ["walkthrough", "editorial", "classic", "underway"],
  details: ["editorial", "classic", "underway", "walkthrough"],
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
/**
 * Segments per video-led reel (Oct 6, Charlie: fewer, longer — 6–7 of 4–6 s,
 * hook 5 s). ReelMaker shares one source per video, so more would be cheap,
 * but they read as choppy.
 */
export const MAX_SEGMENTS = 7;
/**
 * Seconds kept clear after a segment, before the next one or anything already
 * used: a video-led segment keeps playing for VIDEO_LED_CLIP_JOIN (0.75 s)
 * into its crossfade out, plus a little air.
 */
const SEG_MARGIN = 1.0;
/** Two segments of the same video played back to back must be this far apart (fraction of the video), or get a photo between them. */
export const MIN_ADJACENT_GAP = 0.15;
const SEG_PATTERN = [5, 4, 6, 5, 4, 6, 5];
const HOOK_SEC = 5;
/** Clips in a PHOTO-led reel, by angle. */
const PHOTO_LED_SEGMENTS: Record<ReelServiceAngle, number> = { underway_exterior: 3, full_tour: 2, inside: 2, details: 2 };
/** Video-led timing (Oct 6): photo beats 2–2.5 s; a slow smooth crossfade into, out of and between segments. */
export const VIDEO_LED_PHOTO_HOLDS = [2.25, 2.25, 2.5];
export const VIDEO_LED_CLIP_JOIN = 0.75;

const EXTERIOR_WORDS = /(running|underway|aerial|drone|exterior|profile|cruis|sea ?trial|outside|on the water|helicopter)/i;
const INTERIOR_WORDS = /(interior|inside|walk ?-?through|salon|saloon|cabin|stateroom|galley)/i;

const videoText = (v: VideoRow) => `${v.title ?? ""} ${v.filename ?? ""} ${v.description ?? ""}`;
const durOf = (v: VideoRow) => (v.duration_sec && Number(v.duration_sec) > 0 ? Number(v.duration_sec) : null);

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
  underway_exterior: [EDGE, 0.55],
  inside: [0.35, 1 - EDGE],
  details: [EDGE, 1 - EDGE],
};

/** A repeatable 0–1 number for (seed, i): golden-ratio steps, so offsets spread. */
const frac01 = (seed: number, i: number) => {
  const x = 0.5 + seed * 0.6180339887 + i * 0.3819660113;
  return x - Math.floor(x);
};

/** A stretch of a video already used by another reel (fractions of the video). */
export type UsedRange = { videoId: string; from: number; to: number };

/** The ranges a set of segments covers, as fractions of their videos. */
export function usedRanges(segments: ReelServiceSegment[], videos: VideoRow[]): UsedRange[] {
  return segments.map((x) => {
    const v = videos.find((y) => y.id === x.videoId);
    const dur = (v && durOf(v)) || ASSUMED_VIDEO_SEC;
    // + the 0.75 s it keeps playing through its crossfade out.
    return { videoId: x.videoId, from: x.inFrac, to: x.inFrac + (x.durSec + VIDEO_LED_CLIP_JOIN) / dur };
  });
}

/** Seconds kept clear of every edit point in an edited video (Oct 6). */
export const SHOT_EDGE_MARGIN = 0.3;
/** A shot shorter than this (after the margins) is never used. */
export const MIN_SHOT_SEC = 3;
/** Shortest a segment may be cut to fit a shot. */
const MIN_SEGMENT_SEC = 3;

/**
 * The usable stretches of [a,b] (seconds): inside one shot each (with
 * SHOT_EDGE_MARGIN clear of every edit) when the video's shots are known,
 * minus `taken`, keeping pieces at least `min` long. A segment placed in one
 * stretch therefore never crosses an edit.
 */
function freeIntervals(a: number, b: number, taken: [number, number][], min: number, shots?: [number, number][] | null): [number, number][] {
  const bases: [number, number][] = shots && shots.length
    ? shots
        .map((sh) => [Math.max(a, sh[0] + SHOT_EDGE_MARGIN), Math.min(b, sh[1] - SHOT_EDGE_MARGIN)] as [number, number])
        .filter((x) => x[1] - x[0] >= MIN_SHOT_SEC)
    : [[a, b]];
  const sorted = taken.slice().sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  bases.forEach((base) => {
    let cur = base[0];
    sorted.forEach((t) => {
      if (t[1] <= base[0] || t[0] >= base[1]) return;
      if (t[0] > cur) out.push([cur, Math.min(t[0], base[1])]);
      cur = Math.max(cur, t[1]);
    });
    if (cur < base[1]) out.push([cur, base[1]]);
  });
  return out.filter((x) => x[1] - x[0] >= min);
}

/**
 * Lay segments of the given lengths into a video's free stretches (seconds).
 * The free stretches are laid end to end and cut into equal slices, one
 * segment per slice, at an offset set by `seed`. Each segment — plus `tail`,
 * the time it keeps playing through its crossfade out — sits wholly inside
 * one stretch (so inside one shot), never overlapping the one before. A
 * segment longer than the stretch it lands in is shortened to fit (not below
 * MIN_SEGMENT_SEC). Null when they don't fit.
 */
function placeInFree(free: [number, number][], lens: number[], seed: number, tail = 0): { start: number; len: number }[] | null {
  const total = free.reduce((a, f) => a + (f[1] - f[0]), 0);
  const need = lens.reduce((a, l) => a + Math.min(l, MIN_SEGMENT_SEC) + tail, 0);
  if (lens.length === 0 || total < need) return null;
  const slice = total / lens.length;
  // Virtual (end-to-end) position → a stretch and a real time.
  const toReal = (virt: number): { f: number; t: number } => {
    let acc = 0;
    for (let f = 0; f < free.length; f++) {
      const flen = free[f][1] - free[f][0];
      if (virt < acc + flen || f === free.length - 1) return { f, t: free[f][0] + Math.max(0, virt - acc) };
      acc += flen;
    }
    return { f: free.length - 1, t: free[free.length - 1][1] };
  };
  const out: { start: number; len: number }[] = [];
  let lastEnd = -Infinity;
  for (let i = 0; i < lens.length; i++) {
    const want = lens[i];
    const slack = Math.max(0, slice - want - tail - SEG_MARGIN);
    const at = toReal(i * slice + frac01(seed, i) * slack);
    let placed: { start: number; len: number } | null = null;
    for (let f = at.f; f < free.length && placed === null; f++) {
      const lo = Math.max(free[f][0], lastEnd + 0.3);
      const room = free[f][1] - lo;
      if (room < MIN_SEGMENT_SEC + tail) continue;
      // Whole seconds (3–6): a shortened segment is still a clean length.
      const len = Math.min(want, Math.floor(room - tail));
      let st = f === at.f ? Math.max(lo, at.t) : lo;
      if (st + len + tail > free[f][1]) st = free[f][1] - len - tail;
      placed = { start: st, len };
    }
    if (placed === null) return null;
    out.push(placed);
    lastEnd = placed.start + placed.len + tail;
  }
  return out;
}

/**
 * Cut `targetSec` of segments (4–6 s each, hook 5 s, up to `maxCount`) out of
 * a listing's videos for one reel.
 *
 * - Every video's first and last 5% are skipped; an angle can narrow that to
 *   the part of an untitled walkthrough it suits (first ~half for Underway &
 *   exterior, from 35% on for Inside), widened again if it's too short.
 * - Titled videos steer the angle ("running/aerial/drone…" for Underway &
 *   exterior, "interior/walkthrough…" for Inside) when they hold enough.
 * - `used` — what this listing's other reels this month already took — is cut
 *   out first, so a month's reels don't reuse footage. Only when there isn't
 *   room are the used ranges ignored (overlap only where unavoidable).
 * - Segments are shared between videos by free length; inside a video the
 *   free footage is cut into equal slices, one segment per slice, at an offset
 *   set by `seed` — never overlapping within a reel.
 * - Returned in play order (see orderSegments).
 */
export function chooseSegments(
  videos: VideoRow[],
  angle: ReelServiceAngle,
  targetSec: number,
  seed: number,
  maxCount = MAX_SEGMENTS,
  used: UsedRange[] = [],
  tail = 0,
): ReelServiceSegment[] {
  const pool = videos
    .map((v) => ({ v, dur: durOf(v) ?? ASSUMED_VIDEO_SEC, known: durOf(v) !== null }))
    .filter((x) => x.dur >= 8);
  if (pool.length === 0 || targetSec <= 0 || maxCount <= 0) return [];

  const re = angle === "underway_exterior" ? EXTERIOR_WORDS : angle === "inside" ? INTERIOR_WORDS : null;
  const preferred = re ? pool.filter((x) => re.test(videoText(x.v))) : [];
  const prefUsable = preferred.reduce((a, x) => a + x.dur * (1 - 2 * EDGE), 0);
  const titled = preferred.length > 0 && prefUsable >= targetSec * 1.5;
  const cand = titled ? preferred : pool;

  // Lengths, rotated by the seed so reels differ in rhythm too.
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < maxCount && total < targetSec; i++) {
    const l = i === 0 ? HOOK_SEC : SEG_PATTERN[(i + seed) % SEG_PATTERN.length];
    lens.push(l);
    total += l;
  }

  const windowFor = (x: { dur: number }, wide: boolean): [number, number] => {
    const w = wide || titled ? [EDGE, 1 - EDGE] : ANGLE_WINDOW[angle];
    return [w[0] * x.dur, w[1] * x.dur];
  };
  const takenFor = (x: { v: VideoRow; dur: number }, avoidUsed: boolean): [number, number][] =>
    avoidUsed
      ? used.filter((u) => u.videoId === x.v.id).map((u) => [u.from * x.dur - SEG_MARGIN, u.to * x.dur + SEG_MARGIN] as [number, number])
      : [];

  // Angle window avoiding used → whole video avoiding used → angle window
  // ignoring used → whole video ignoring used. The first that fits wins.
  const attempts: [boolean, boolean][] = [[false, true], [true, true], [false, false], [true, false]];
  for (let a = 0; a < attempts.length; a++) {
    const wide = attempts[a][0], avoidUsed = attempts[a][1];
    const frees = cand.map((x) => {
      const w = windowFor(x, wide);
      return freeIntervals(w[0], w[1], takenFor(x, avoidUsed), MIN_SEGMENT_SEC + tail, x.v.shots);
    });
    const freeLen = frees.map((f) => f.reduce((acc, x) => acc + (x[1] - x[0]), 0));
    const sum = freeLen.reduce((x, y) => x + y, 0);
    if (sum <= 0) continue;
    // Spread over the free footage, not packed: each segment gets ~3x its
    // length of room if the footage allows, else ~2.2x, else 1.5x; segments
    // are dropped only when even that doesn't fit.
    const fit = (factor: number) => {
      const out = lens.slice();
      while (out.length > 0 && out.reduce((x, y) => x + y * factor, 0) > sum) out.pop();
      return out;
    };
    let L = fit(3);
    if (L.length < lens.length) { const l2 = fit(2.2); L = l2.length < lens.length ? fit(1.5) : l2; }
    if (L.length < Math.min(3, lens.length)) continue;
    // Share out by free length (largest remainder).
    const counts = freeLen.map((f) => Math.floor((f / sum) * L.length));
    let left = L.length - counts.reduce((x, y) => x + y, 0);
    const byRem = freeLen
      .map((f, i) => ({ i, r: (f / sum) * L.length - Math.floor((f / sum) * L.length) }))
      .sort((x, y) => y.r - x.r);
    for (let k = 0; left > 0 && byRem.length; k = (k + 1) % byRem.length) { counts[byRem[k].i]++; left--; }
    // Hand out the lengths in turn; the hook goes to the first (preferred) video.
    const perVideo: number[][] = cand.map(() => []);
    let li = 0;
    for (let round = 0; li < L.length && round <= L.length; round++) {
      for (let vi = 0; vi < cand.length && li < L.length; vi++) {
        if (perVideo[vi].length < counts[vi]) perVideo[vi].push(L[li++]);
      }
    }
    const out: ReelServiceSegment[] = [];
    let ok = true;
    cand.forEach((x, vi) => {
      if (!ok || perVideo[vi].length === 0) return;
      let starts = placeInFree(frees[vi], perVideo[vi], seed + vi * 3, tail);
      if (!avoidUsed && used.length > 0) {
        // Overlap can't be avoided any more: of a dozen placements, take the
        // one that overlaps this month's other reels least.
        const usedHere = takenFor(x, true);
        const overlap = (st: { start: number; len: number }[]) => st.reduce((acc, p0) => {
          const a0 = p0.start, a1 = p0.start + p0.len + tail;
          return acc + usedHere.reduce((o, u) => o + Math.max(0, Math.min(a1, u[1]) - Math.max(a0, u[0])), 0);
        }, 0);
        for (let k = 1; k < 12; k++) {
          const alt = placeInFree(frees[vi], perVideo[vi], seed + vi * 3 + k * 17, tail);
          if (alt && (!starts || overlap(alt) < overlap(starts))) starts = alt;
        }
      }
      if (!starts) { ok = false; return; }
      starts.forEach((p0) => out.push({
        videoId: x.v.id,
        inFrac: Math.round((p0.start / x.dur) * 100000) / 100000,
        // Hundredths: rounding to tenths could nudge a segment into the 0.3 s it keeps clear of an edit.
        inSec: x.known ? Math.round(p0.start * 100) / 100 : null,
        durSec: p0.len as ReelServiceSegment["durSec"],
      }));
    });
    if (!ok || out.length === 0) continue;
    return orderSegments(out, seed, angle);
  }
  return [];
}

/**
 * Play order. The hook comes first (see below); then each time the earliest
 * remaining
 * segment at least MIN_ADJACENT_GAP of its video away from the previous one
 * (a segment of another video always qualifies). When none qualifies the
 * farthest is taken, and that join gets a photo between (videoLedOrder).
 */
export function orderSegments(segs: ReelServiceSegment[], seed: number, angle: ReelServiceAngle): ReelServiceSegment[] {
  const rest = segs.slice().sort((a, b) => (a.videoId === b.videoId ? a.inFrac - b.inFrac : a.videoId < b.videoId ? -1 : 1));
  if (rest.length <= 1) return rest;
  const gap = (a: ReelServiceSegment, b: ReelServiceSegment) => (a.videoId === b.videoId ? Math.abs(a.inFrac - b.inFrac) : 1);
  // The hook is a 5 s+ segment: the earliest for Full tour and Underway &
  // exterior (walkthroughs open outside, often running), a seed-chosen one of
  // the first three otherwise.
  const hooks = rest.map((x, i) => ({ x, i })).filter((h) => h.x.durSec >= HOOK_SEC);
  const pool = hooks.length ? hooks : rest.map((x, i) => ({ x, i }));
  const early = angle === "underway_exterior" || angle === "full_tour";
  const hookAt = pool[early ? 0 : Math.floor(frac01(seed, 7) * Math.min(pool.length, 3))].i;
  const out = [rest.splice(hookAt, 1)[0]];
  while (rest.length) {
    const prev = out[out.length - 1];
    let k = rest.findIndex((x) => gap(prev, x) >= MIN_ADJACENT_GAP);
    if (k < 0) {
      k = 0;
      rest.forEach((x, i) => { if (gap(prev, x) > gap(prev, rest[k])) k = i; });
    }
    out.push(rest.splice(k, 1)[0]);
  }
  return out;
}

/** Joins (i = between segment i and i+1) where two segments of one video are too close in time to sit back to back. */
export function closeJoins(segs: ReelServiceSegment[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < segs.length; i++) {
    const a = segs[i], b = segs[i + 1];
    if (a.videoId === b.videoId && Math.abs(a.inFrac - b.inFrac) < MIN_ADJACENT_GAP) out.push(i);
  }
  return out;
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
 * Video-led order: open on the hook (the title is drawn over it), mostly
 * video, photo beats between segments. Photos go first where two segments of
 * the same video are too close in time to sit back to back (`mustSplit`),
 * then evenly into the remaining joins.
 */
export function videoLedOrder(photoIds: string[], segCount: number, mustSplit: number[] = []): string[] {
  const joins: number[] = [];
  mustSplit.forEach((j) => { if (j >= 0 && j < segCount - 1 && joins.indexOf(j) < 0 && joins.length < photoIds.length) joins.push(j); });
  const spare = photoIds.length - joins.length;
  const free: number[] = [];
  for (let j = 0; j < segCount - 1; j++) if (joins.indexOf(j) < 0) free.push(j);
  for (let k = 0; k < spare && free.length; k++) {
    const idx = Math.min(free.length - 1, Math.max(0, Math.round(((k + 1) * (free.length + 1)) / (spare + 1)) - 1));
    joins.push(free.splice(idx, 1)[0]);
  }
  joins.sort((a, b) => a - b);
  const out: string[] = [];
  let pj = 0;
  for (let i = 0; i < segCount; i++) {
    out.push(`clip:${i}`);
    if (joins.indexOf(i) >= 0 && pj < photoIds.length) out.push(photoIds[pj++]);
  }
  while (pj < photoIds.length) out.push(photoIds[pj++]);
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

/**
 * Add each video's detected shots (videos.shot_cuts, Oct 6). A separate read,
 * so that before that column exists — or if it can't be read — planning goes
 * on exactly as before, just without shot boundaries.
 */
async function attachShots(admin: SupabaseClient, videos: VideoRow[]): Promise<VideoRow[]> {
  if (videos.length === 0) return videos;
  try {
    const { data, error } = await admin.from("videos").select("id, shot_cuts").in("id", videos.map((v) => v.id));
    if (error || !data) return videos;
    const byId: Record<string, [number, number][] | null> = {};
    (data as { id: string; shot_cuts: unknown }[]).forEach((r) => {
      const info = parseShotInfo(r.shot_cuts);
      byId[r.id] = info ? info.shots : null;
    });
    return videos.map((v) => ({ ...v, shots: byId[v.id] ?? null }));
  } catch {
    return videos;
  }
}

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
  const allVideos = await attachShots(admin, (videos ?? []) as VideoRow[]);
  const out: ListingPack[] = [];
  rows.forEach((l) => {
    const ph = ((photos ?? []) as (PhotoRow & { listing_id: string })[]).filter((p) => p.listing_id === l.id);
    if (ph.length < MIN_LISTING_PHOTOS) return;
    const ordered = orderPhotos(ph, { manual: l.photo_order_manual === true, heroId: l.hero_photo_id });
    const vids = (allVideos as (VideoRow & { listing_id: string })[]).filter((v) => v.listing_id === l.id);
    out.push({ listing: l, ordered, videos: vids });
  });
  return out;
}

type PlanContext = {
  /** All jobs on the listings being planned, every period. */
  history: JobRow[];
  period: string;
  /** Reels this listing gets this month — so each reel takes a fair share of short footage. */
  perListing?: number;
};

/** Photo beats in a video-led reel: 3, or as many as the too-close joins need (at most 4). */
function photoBeats(segCount: number, mustSplit: number): number {
  return Math.min(Math.max(1, segCount - 1), Math.max(3, Math.min(4, mustSplit)));
}

/**
 * The segments, order and estimates for a job, given its angle, look and
 * photos. Shared by the planner and "Change look". `used` = footage this
 * listing's other reels this month already took.
 */
function buildMedia(
  videos: VideoRow[],
  angle: ReelServiceAngle,
  look: StyleKey,
  picked: string[],
  seed: number,
  variant: number,
  used: UsedRange[] = [],
  reelsThisMonth = 4,
): Pick<ReelServiceSettings, "order" | "photoIds" | "segments" | "length" | "videoLed" | "footageSec" | "unmeasuredVideos" | "needsMoreVideo" | "estVideoSec" | "estPhotoSec" | "photoHoldSec" | "clipJoinSec"> {
  const f = footageOf(videos);
  const enough = videos.length > 0 && f.effectiveSec >= VIDEO_LED_MIN_FOOTAGE;
  const videoLed = enough && lookIsVideoLed(look);
  const base = {
    footageSec: f.measuredSec,
    unmeasuredVideos: f.unmeasured,
    needsMoreVideo: !enough,
  };
  if (videoLed) {
    // 6–7 segments of 4–6 s: ~30–34 s of video (never more than ~85% of what
    // there is); with 3–4 photo beats of 2–2.5 s and the end card, ~40–45 s.
    // On footage too short for a month of separate reels the reel length
    // wins (30–45 s) and later reels overlap earlier ones as little as they
    // can (see chooseSegments). `reelsThisMonth` is kept for the board's note.
    void reelsThisMonth;
    const target = Math.min(30 + (variant % 3) * 2, Math.max(16, f.effectiveSec * 0.85));
    const segments = chooseSegments(videos, angle, target, seed, MAX_SEGMENTS, used, VIDEO_LED_CLIP_JOIN);
    const videoSec = segments.reduce((a, x) => a + x.durSec, 0);
    if (segments.length >= 3) {
      const must = closeJoins(segments);
      const photoIds = spreadIds(picked, photoBeats(segments.length, must.length), variant);
      const hold = VIDEO_LED_PHOTO_HOLDS[variant % VIDEO_LED_PHOTO_HOLDS.length];
      return {
        ...base,
        videoLed: true,
        segments,
        photoIds,
        order: videoLedOrder(photoIds, segments.length, must),
        length: "full",
        estVideoSec: videoSec,
        // Each beat's slot = its hold fully on screen + the crossfade into it.
        estPhotoSec: Math.round(photoIds.length * (hold + VIDEO_LED_CLIP_JOIN) * 10) / 10,
        photoHoldSec: hold,
        clipJoinSec: VIDEO_LED_CLIP_JOIN,
      };
    }
  }
  // Photo-led (as before): the angle's photos, a few clips threaded through.
  const segments = lookPlaysClips(look) && videos.length > 0
    ? chooseSegments(videos, angle, PHOTO_LED_SEGMENTS[angle] * 5, seed, PHOTO_LED_SEGMENTS[angle], used)
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
    photoHoldSec: null,
    clipJoinSec: null,
  };
}

/** `n` ids spread through a list (keeps order; the first stays first). */
function spreadIds(ids: string[], n: number, variant: number): string[] {
  if (ids.length <= n) return ids.slice();
  return uniq([ids[0], ...spread(ids.slice(1), n - 1, variant)]).slice(0, n);
}

/** Build one job's plan for a listing, given what's already planned. */
/** A number for a reel's place in time: its month and slot (and a re-plan bump), so every reel's segment seed differs. */
function segmentSeed(period: string, slot: number, bump: number): number {
  const [y, m] = period.split("-").map(Number);
  return ((y * 12 + m) % 97) * 7 + slot * 13 + bump * 5;
}

function planOne(pack: ListingPack, ctx: PlanContext, opts: { excludeJobId?: string; forceLook?: StyleKey; bump?: number; slot?: number } = {}) {
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
    // Video-led: last month's looks in general aren't avoided — with four
    // reels and exactly four video-led looks (Editorial, Walkthrough,
    // Underway, Classic) every look is used every month anyway.
    const fallbackOnly: StyleKey[] = [];
    const tiers: { avoid: StyleKey[]; needClips: boolean }[] = videoLedPossible
      ? [
          { avoid: uniq([...looksThisMonth, ...lastSameAngle, ...fallbackOnly]), needClips: true },
          { avoid: uniq([...looksThisMonth, ...fallbackOnly]), needClips: true },
          { avoid: looksThisMonth, needClips: true },
        ]
      : [
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
  // Segments: seeded by month + slot, and kept off the footage this
  // listing's other reels this month already use.
  const seed = segmentSeed(ctx.period, opts.slot ?? onListingThisMonth.length + 1, opts.bump ?? 0);
  const used = usedRanges(
    onListingThisMonth.reduce((acc: ReelServiceSegment[], j) => acc.concat(j.settings?.segments ?? []), []),
    videos,
  );
  const media = buildMedia(videos, angle, look, picked.map((p) => p.id), seed, variant, used, ctx.perListing ?? 4);
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
    const ctx: PlanContext = { history: ((hist ?? []) as JobRow[]).slice(), period, perListing };

    for (const pack of packs) {
      result.listings++;
      const current = ctx.history.filter((j) => j.listing_id === pack.listing.id && j.period === period);
      const missing = Math.max(0, perListing - current.length);
      const taken = current.map((j) => j.slot);
      for (let s = 0; s < missing; s++) {
        let slot = 1;
        while (taken.indexOf(slot) >= 0) slot++;
        taken.push(slot);
        const plan = planOne(pack, ctx, { slot });
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
 * Re-plan one job: a different angle/photo variant, fresh footage (kept off
 * the listing's other reels this month) and, unless `look` is given, a fresh
 * look. Admin testing (Oct 6): a DELIVERED job may be re-planned too — it goes
 * back to 'planned' (off the broker's Your Reels page until it is made and
 * delivered again). A job that is rendering right now is left alone.
 */
export async function replanReelServiceJob(
  admin: SupabaseClient,
  jobId: string,
  opts: { look?: StyleKey } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: job } = await admin.from("reel_service_jobs")
    .select("id, broker_id, listing_id, period, slot, angle, look, status, settings").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, error: "Job not found." };
  if (job.status === "rendering") return { ok: false, error: "It\u2019s rendering \u2014 wait for it to finish (or fail), then re-plan." };
  const { data: hist } = await admin.from("reel_service_jobs")
    .select("id, broker_id, listing_id, period, slot, angle, look, status, settings").eq("listing_id", job.listing_id);
  const packs = await loadListingPacks(admin, job.broker_id);
  const pack = packs.find((p) => p.listing.id === job.listing_id);
  if (!pack) return { ok: false, error: "This listing is no longer active or has too few photos to plan." };
  const ctx: PlanContext = {
    history: (hist ?? []) as JobRow[],
    period: job.period,
    perListing: ((hist ?? []) as JobRow[]).filter((j) => j.period === job.period).length,
  };
  const bump = 1 + Math.floor(Math.random() * 5);
  let plan = planOne(pack, ctx, { excludeJobId: job.id, forceLook: opts.look, bump, slot: job.slot });
  // A re-plan should change the look too, unless one was asked for.
  if (!opts.look && plan.look === job.look) {
    const taken = ((hist ?? []) as JobRow[])
      .filter((j) => j.id !== job.id && j.period === job.period)
      .map((j) => j.look as StyleKey)
      .concat([job.look as StyleKey]);
    const videoLed = pack.videos.length > 0 && footageOf(pack.videos).effectiveSec >= VIDEO_LED_MIN_FOOTAGE;
    const other = chooseLook(plan.angle as ReelServiceAngle, { avoid: taken, preferClips: pack.videos.length > 0, skip: [job.look as StyleKey], videoLed });
    plan = planOne(pack, ctx, { excludeJobId: job.id, forceLook: other, bump, slot: job.slot });
  }
  const { error } = await admin.from("reel_service_jobs").update({
    angle: plan.angle,
    look: plan.look,
    settings: plan.settings,
    caption: plan.caption,
    status: "planned",
    error: null,
    delivered_at: null,
  }).eq("id", job.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Re-plan EVERY reel of one listing for a month, in slot order, as if the
 * month were being planned from scratch (slot 1 is the launch Full tour if
 * the listing has no reels in other months; four angles, four looks, no shared
 * footage). Delivered ones included — they go back to 'planned'. Reels that
 * are rendering right now are skipped. For testing and for a listing whose
 * plan went wrong.
 */
export async function replanListingMonth(
  admin: SupabaseClient,
  period: string,
  listingId: string,
): Promise<{ ok: true; replanned: number; skipped: number } | { ok: false; error: string }> {
  const { data: rows } = await admin.from("reel_service_jobs")
    .select("id, broker_id, listing_id, period, slot, angle, look, status, settings").eq("listing_id", listingId);
  const all = (rows ?? []) as JobRow[];
  const month = all.filter((j) => j.period === period).sort((a, b) => a.slot - b.slot);
  if (month.length === 0) return { ok: false, error: "No reels planned for this listing this month." };
  const packs = await loadListingPacks(admin, month[0].broker_id);
  const pack = packs.find((p) => p.listing.id === listingId);
  if (!pack) return { ok: false, error: "This listing is no longer active or has too few photos to plan." };
  // Start from the other months only; add each re-planned reel as we go.
  const ctx: PlanContext = { history: all.filter((j) => j.period !== period || j.status === "rendering"), period, perListing: month.length };
  let replanned = 0, skipped = 0;
  for (const job of month) {
    if (job.status === "rendering") { skipped++; continue; }
    const plan = planOne(pack, ctx, { slot: job.slot });
    const { error } = await admin.from("reel_service_jobs").update({
      angle: plan.angle,
      look: plan.look,
      settings: plan.settings,
      caption: plan.caption,
      status: "planned",
      error: null,
      delivered_at: null,
    }).eq("id", job.id);
    if (error) return { ok: false, error: error.message };
    ctx.history.push({ ...job, angle: plan.angle, look: plan.look, settings: plan.settings, status: "planned" });
    replanned++;
  }
  return { ok: true, replanned, skipped };
}

/**
 * Change only the look. The media is rebuilt for it (a video-led reel needs
 * one of VIDEO_LED_LOOKS; a look without clips gets none), keeping the job's
 * angle and photos, and still kept off the listing's other reels' footage.
 */
export async function setReelServiceJobLook(admin: SupabaseClient, jobId: string, look: StyleKey): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!REEL_STYLES[look]) return { ok: false, error: "Unknown look." };
  const { data: job } = await admin.from("reel_service_jobs").select("id, listing_id, period, slot, angle, status, settings").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, error: "Job not found." };
  if (job.status === "delivered") return { ok: false, error: "Already delivered \u2014 Re-plan it first." };
  const settings = (job.settings ?? {}) as ReelServiceSettings;
  const [{ data: vids }, { data: siblings }] = await Promise.all([
    admin.from("videos").select(VIDEO_SELECT).eq("listing_id", job.listing_id).order("display_order"),
    admin.from("reel_service_jobs").select("id, settings").eq("listing_id", job.listing_id).eq("period", job.period).neq("id", job.id),
  ]);
  const videos = await attachShots(admin, (vids ?? []) as VideoRow[]);
  if (settings.videoLed && !lookIsVideoLed(look)) {
    return { ok: false, error: `${REEL_STYLES[look].name} isn\u2019t used for video-led reels. Pick ${VIDEO_LED_LOOKS.map((k) => REEL_STYLES[k].name).join(", ")}.` };
  }
  const used = usedRanges(
    ((siblings ?? []) as { settings: ReelServiceSettings | null }[]).reduce((acc: ReelServiceSegment[], j) => acc.concat(j.settings?.segments ?? []), []),
    videos,
  );
  // The full photo pick for the angle isn't stored for video-led jobs (only
  // the beats), so the photos stay as they are; segments are rebuilt.
  const seed = segmentSeed(job.period, job.slot, 0);
  const media = buildMedia(videos, job.angle as ReelServiceAngle, look, settings.photoIds ?? [], seed, settings.variant ?? 0, used);
  const next: ReelServiceSettings = { ...settings, ...media };
  const { error } = await admin.from("reel_service_jobs").update({ look, settings: next, status: "planned", error: null }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
