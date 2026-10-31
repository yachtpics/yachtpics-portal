/**
 * "In Review" reels (admin, Oct 31) — the shared rules. Safe on the server
 * and in the browser (no storage, no DOM).
 *
 * A reel of ONE photo per boat YachtPics shot in a period — month, quarter,
 * half, year — with an opening card ("October 2026 in review / 59 boats
 * photographed") and the YachtPics end card. Nothing on the boat frames.
 *
 *   • which boats: listings.photographed_at (else created_at) inside the
 *     period, in Eastern time; pocket listings (showcase_opt_out) and test
 *     brokers left out; sold boats kept (they were shot).
 *   • which photo: pickProfilePhoto below (cover, else first Profiles photo;
 *     a boat with neither is left out).
 *   • timing: reviewTimeline below; the renderer is src/lib/reviewReelRender.ts.
 */

// ── Formats ────────────────────────────────────────────────────────────────

/** The two frames ReelMaker renders (its SPEC.reel and SPEC.film). */
export type ReviewFormat = "vertical" | "wide";
export const REVIEW_FRAMES: Record<ReviewFormat, { w: number; h: number; label: string; hint: string }> = {
  vertical: { w: 1080, h: 1920, label: "Vertical (9:16)", hint: "Instagram Reels, Stories, Facebook" },
  wide: { w: 1920, h: 1080, label: "Widescreen (16:9)", hint: "YouTube, website, a screen at a show" },
};

export type ReviewTransition = "cut" | "crossfade";
/** "fill" = full-bleed crop; "whole" = whole photo on a blurred plate (ReelMaker's "whole"). */
export type ReviewFraming = "fill" | "whole";

// ── Timing ─────────────────────────────────────────────────────────────────

export const SEC_PER_BOAT_MIN = 0.4;
export const SEC_PER_BOAT_MAX = 2.0;
export const OPEN_CARD_SEC = 2.6;
/** ReelMaker's end hold on a YachtPics-branded reel (3.0 + 1.5). */
export const END_CARD_SEC = 4.5;
/** Opening card → first boat. */
export const OPEN_XFADE = 0.4;
/** Last boat → end card (ReelMaker dissolves into its end card too). */
export const END_XFADE = 0.5;

/** 1.0 s up to 60 boats, 0.7 s up to 150, 0.5 s beyond. */
export function defaultSecPerBoat(n: number): number {
  return n <= 60 ? 1.0 : n <= 150 ? 0.7 : 0.5;
}

/** A quick crossfade, never more than ~45% of a boat's time. */
export function crossfadeSec(secPerBoat: number): number {
  return Math.min(0.3, secPerBoat * 0.45);
}

export type ReviewItem = { kind: "open" | "photo" | "end"; index: number; start: number; dur: number; fadeIn: number };

/**
 * Opening card, then boat i at OPEN_CARD_SEC + i × sec, then the end card.
 * A crossfade lays the incoming item over the outgoing one for `fadeIn`; the
 * outgoing item's `dur` runs to the end of that overlap.
 */
export function reviewTimeline(n: number, secPerBoat: number, transition: ReviewTransition): { items: ReviewItem[]; total: number; endStart: number } {
  const xf = transition === "crossfade" ? crossfadeSec(secPerBoat) : 0;
  const items: ReviewItem[] = [];
  items.push({ kind: "open", index: -1, start: 0, dur: OPEN_CARD_SEC + OPEN_XFADE, fadeIn: 0 });
  for (let i = 0; i < n; i++) {
    const start = OPEN_CARD_SEC + i * secPerBoat;
    const last = i === n - 1;
    items.push({ kind: "photo", index: i, start, dur: secPerBoat + (last ? END_XFADE : xf), fadeIn: i === 0 ? OPEN_XFADE : xf });
  }
  const endStart = OPEN_CARD_SEC + n * secPerBoat;
  items.push({ kind: "end", index: -1, start: endStart, dur: END_CARD_SEC, fadeIn: n > 0 ? END_XFADE : OPEN_XFADE });
  return { items, total: endStart + END_CARD_SEC, endStart };
}

export function reviewDuration(n: number, secPerBoat: number): number {
  return OPEN_CARD_SEC + n * secPerBoat + END_CARD_SEC;
}

/** "1:12" */
export function formatRunTime(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── Periods (Eastern time) ─────────────────────────────────────────────────

export type PresetKey = "this_month" | "last_month" | "last_3" | "last_6" | "this_year" | "last_12" | "custom";
export const PRESETS: { key: Exclude<PresetKey, "custom">; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_3", label: "Last 3 months" },
  { key: "last_6", label: "Last 6 months" },
  { key: "this_year", label: "This year" },
  { key: "last_12", label: "Last 12 months" },
];

const TZ = "America/New_York";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** Days in month m (1–12). */
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function isYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`));
}

function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

/** Today's date in Eastern time, "YYYY-MM-DD". */
export function todayET(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return p.slice(0, 10);
}

/** The UTC instant of midnight Eastern time at the start of `day`. */
export function etMidnightUtc(day: string): string {
  const { y, m, d } = parseYmd(day);
  const guess = Date.UTC(y, m - 1, d, 5, 0, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  const asEt = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  const offset = asEt - guess; // negative: ET is behind UTC
  return new Date(Date.UTC(y, m - 1, d) - offset).toISOString();
}

/** The day after `day`. */
export function nextDay(day: string): string {
  const { y, m, d } = parseYmd(day);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Whole calendar months; `to` is inclusive. */
export function presetRange(key: Exclude<PresetKey, "custom">, today: string = todayET()): { from: string; to: string } {
  const { y, m } = parseYmd(today);
  const monthsBack = (k: number) => { // first day of the month k months before this one
    const t = new Date(Date.UTC(y, m - 1 - k, 1));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
  };
  const lastPrev = monthsBack(1);
  const endOfPrev = ymd(lastPrev.y, lastPrev.m, daysIn(lastPrev.y, lastPrev.m));
  switch (key) {
    case "this_month": return { from: ymd(y, m, 1), to: today };
    case "last_month": return { from: ymd(lastPrev.y, lastPrev.m, 1), to: endOfPrev };
    case "last_3": { const s = monthsBack(3); return { from: ymd(s.y, s.m, 1), to: endOfPrev }; }
    case "last_6": { const s = monthsBack(6); return { from: ymd(s.y, s.m, 1), to: endOfPrev }; }
    case "this_year": return { from: ymd(y, 1, 1), to: today };
    case "last_12": { const s = monthsBack(12); return { from: ymd(s.y, s.m, 1), to: endOfPrev }; }
  }
}

/**
 * The opening card's first line: "October 2026 in review" for a month (whole
 * or to date), "2026 in review" for a year from 1 January, "Aug – Oct 2026 in
 * review" for whole months, else the dates.
 */
export function reviewTitle(from: string, to: string): string {
  if (!isYmd(from) || !isYmd(to)) return "In review";
  const a = parseYmd(from), b = parseYmd(to);
  const startsMonth = a.d === 1;
  const endsMonth = b.d === daysIn(b.y, b.m);
  if (startsMonth && a.y === b.y && a.m === b.m) return `${MONTHS[a.m - 1]} ${a.y} in review`;
  if (startsMonth && a.m === 1 && a.y === b.y) return `${a.y} in review`;
  if (startsMonth && endsMonth) {
    return a.y === b.y
      ? `${MON[a.m - 1]} – ${MON[b.m - 1]} ${b.y} in review`
      : `${MON[a.m - 1]} ${a.y} – ${MON[b.m - 1]} ${b.y} in review`;
  }
  return a.y === b.y
    ? `${MON[a.m - 1]} ${a.d} – ${MON[b.m - 1]} ${b.d}, ${b.y} in review`
    : `${MON[a.m - 1]} ${a.d}, ${a.y} – ${MON[b.m - 1]} ${b.d}, ${b.y} in review`;
}

export function boatsLine(n: number): string {
  return `${n} boat${n === 1 ? "" : "s"} photographed`;
}

/** "October 2026 in review — 59 boats photographed by YachtPics. #YachtPics #YachtPhotography" */
export function reviewCaption(title: string, n: number): string {
  const t = title.trim() || "In review";
  return `${t} — ${boatsLine(n)} by YachtPics.\n\n#YachtPics #YachtPhotography`;
}

export function reviewFileName(title: string, format: ReviewFormat): string {
  const base = (title.trim() || "In-review").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `YachtPics-${base}-${format === "vertical" ? "9x16" : "16x9"}.mp4`;
}

// ── Which boats ────────────────────────────────────────────────────────────

/** A test / demo broker account (by name; e.g. John Doe). */
export function isTestBroker(b: { first_name: string | null; last_name: string | null; display_email: string | null }): boolean {
  const name = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim().toLowerCase();
  const email = (b.display_email ?? "").toLowerCase();
  return /\b(test|demo|sample|example)\b/.test(name)
    || ["john doe", "jane doe"].indexOf(name) >= 0
    || /\b(test|demo)\b|example\.com/.test(email);
}

// ── Which photo ────────────────────────────────────────────────────────────

export type PickablePhoto = { id: string; category?: string | null };

/**
 * The one photo for a boat — Charlie's rule (Oct 31). `ordered` = the
 * listing's visible photos in its own order (orderPhotos: manual order, or
 * the canonical category order with display_order inside each category).
 *   1. the listing's cover (hero) photo, if one is set and visible;
 *   2. otherwise the first "Profiles" photo.
 * Nothing else: no Running / Aerial / side / other fallback. Null = the boat
 * stays out of the reel (the page lists it under "Not included — no profile
 * photo", where a photo can be chosen by hand).
 */
export function pickProfilePhoto<T extends PickablePhoto>(ordered: T[], heroId: string | null | undefined): T | null {
  if (heroId) {
    const h = ordered.find((p) => p.id === heroId);
    if (h) return h;
  }
  return ordered.find((p) => (p.category ?? "").trim().toLowerCase() === "profiles") ?? null;
}

// ── API shapes ─────────────────────────────────────────────────────────────

export type ReviewBoat = {
  listingId: string;
  name: string;
  /** "2019 · 64′ Viking 64 Convertible" — for the grid only, never drawn. */
  spec: string;
  brokerName: string;
  /** photographed_at, else created_at. */
  shotAt: string;
  /** True when there is no photographed_at (the date is the listing's creation). */
  shotDateGuessed: boolean;
  sold: boolean;
  photoCount: number;
  /** The reel photo. On a boat in `noProfile` (no cover, no Profiles photo) id is "" until one is chosen by hand. */
  photo: { id: string; category: string | null; thumb: string | null };
};

export type ReviewPhotoOption = { id: string; category: string | null; thumb: string | null };

/** What a saved In Review reel keeps, so it can be rendered again. */
export type ReviewReelSettings = {
  format: ReviewFormat;
  secPerBoat: number;
  /** Seconds per boat was moved off the automatic default. */
  secManual?: boolean;
  transition: ReviewTransition;
  framing: ReviewFraming;
  music: { mood: string; seed: number };
  line1: string;
  line2: string;
};

export type ReviewReelItem = { listingId: string; photoId: string; included: boolean };

export type SavedReviewReel = {
  id: string;
  title: string;
  period_from: string;
  period_to: string;
  preset: string | null;
  settings: ReviewReelSettings;
  items: ReviewReelItem[];
  boat_count: number;
  caption: string | null;
  rendered_at: string | null;
  updated_at: string;
};
