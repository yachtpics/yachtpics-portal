/**
 * Reel looks — the four ways a listing film can present itself.
 *
 * Drawn from how the top houses actually publish. Three conventions from that
 * research shaped all of this:
 *
 *  1. Never open on a card. The photograph is on screen in frame one and the
 *     title fades up over it. A logo card burns the seconds that decide whether
 *     anyone watches at all.
 *  2. Consistency reads as intent. Every photo in a reel moves the same amount,
 *     with the same easing. Random per-photo variation is the tell of a
 *     template — the thing these brokers are paying us not to look like.
 *  3. Restraint scales with price. The most expensive-looking work is the least
 *     decorated: a hairline, wide tracking, and room to breathe.
 *
 * Each style is a complete point of view, not a colour swap — different
 * backdrop, typography, alignment and motion. A broker picks the one that suits
 * the boat: a 120' tri-deck and a classic sloop should not present alike.
 */

export type StyleKey = "editorial" | "cinematic" | "gallery" | "classic";

export type Backdrop =
  | "scrim"      // full-bleed photo, type grounded on a bottom-up gradient
  | "letterbox"  // 1.85:1 window, type in the black bar below it (reels only)
  | "inset"      // photo inset on a light ground, type beneath
  | "plate";     // photo above a solid colour plate, type on the plate

export type ReelStyle = {
  key: StyleKey;
  name: string;
  /** One line for the picker — what it is, not how it's built. */
  blurb: string;
  /** Ground: letterbox bars, plate, or the page behind an inset photo. */
  ground: string;
  /** Primary type colour. */
  text: string;
  soft: string;
  quiet: string;
  accent: string;
  /** True when the ground is light — flips shadows and scrims. */
  light: boolean;
  backdrop: Backdrop;
  /** Headline family + how the vessel name is cased. */
  serifHeadline: boolean;
  headline: "editorial" | "caps" | "sentence" | "title";
  align: "center" | "left";
  rule: "single" | "double" | "none";
  /** Headline tracking, in px at a 1080 short edge. */
  headTrack: number;
  /** Total push-in over a photo's time on screen. Never past 0.14. */
  zoom: number;
  /** Multiplier on the format's base hold — slower styles linger. */
  holdScale: number;
};

export const REEL_STYLES: Record<StyleKey, ReelStyle> = {
  /**
   * Editorial — the house style, and the default.
   *
   * Modelled on Edmiston's headline grammar: an italic lowercase lead-in
   * against the vessel name in caps, closed with a full stop. The period is
   * doing real work — it reads as a statement rather than a label.
   */
  editorial: {
    key: "editorial",
    name: "Editorial",
    blurb: "Serif caps on a soft gradient. The brokerage-brochure look.",
    ground: "#050b14",
    text: "#ffffff",
    soft: "rgba(255,255,255,0.86)",
    quiet: "rgba(255,255,255,0.62)",
    accent: "#dfc98a",
    light: false,
    backdrop: "scrim",
    serifHeadline: true,
    headline: "editorial",
    align: "center",
    rule: "single",
    headTrack: 3,
    zoom: 0.08,
    holdScale: 1,
  },

  /**
   * Cinematic — letterboxed, and the quietest of the four.
   *
   * On a reel the photograph never carries type: it sits in a 1.85:1 window
   * with the name in the bar beneath. On a film (already widescreen) the bars
   * would only shrink the picture, so it keeps the type and the slow motion
   * over a gradient instead. Widest tracking, thinnest weight, least movement.
   * Best on a big boat with big photography.
   */
  cinematic: {
    key: "cinematic",
    name: "Cinematic",
    blurb: "Letterboxed on reels, wide-tracked, slow. The quietest of the four.",
    ground: "#000000",
    text: "#ffffff",
    soft: "rgba(255,255,255,0.72)",
    quiet: "rgba(255,255,255,0.48)",
    accent: "#c9b183",
    light: false,
    backdrop: "letterbox",
    serifHeadline: true,
    headline: "caps",
    align: "center",
    rule: "none",
    headTrack: 11,
    zoom: 0.05,
    holdScale: 1.15,
  },

  /**
   * Gallery — light, and the only one that isn't dark.
   *
   * Warm off-white rather than white; the photograph is inset with real margin
   * and the type sits under it in a tight sans. Reads modern and understated —
   * the register a builder's own brochure uses.
   */
  gallery: {
    key: "gallery",
    name: "Gallery",
    blurb: "Warm off-white, photo inset, quiet modern type.",
    ground: "#f4f2ed",
    text: "#141a21",
    soft: "rgba(20,26,33,0.72)",
    quiet: "rgba(20,26,33,0.52)",
    accent: "#8a6d34",
    light: true,
    backdrop: "inset",
    serifHeadline: false,
    headline: "sentence",
    align: "center",
    rule: "single",
    headTrack: -1,
    zoom: 0.06,
    holdScale: 0.95,
  },

  /**
   * Classic — warm, lower-left, double hairline.
   *
   * For sailing yachts, classics and anything with varnish. The scrim is warmed
   * rather than neutral, the name is title case rather than shouted, and the
   * type sits lower-left like a plate on a hull.
   */
  classic: {
    key: "classic",
    name: "Classic",
    blurb: "Warm tones, title case, set lower-left. Suits classics and sail.",
    ground: "#14100a",
    text: "#fdfaf4",
    soft: "rgba(253,250,244,0.82)",
    quiet: "rgba(253,250,244,0.58)",
    accent: "#d8bd86",
    light: false,
    backdrop: "scrim",
    serifHeadline: true,
    headline: "title",
    align: "left",
    rule: "double",
    headTrack: 1,
    zoom: 0.07,
    holdScale: 1.05,
  },
};

export const STYLE_ORDER: StyleKey[] = ["editorial", "cinematic", "gallery", "classic"];

// ── Brand colours ────────────────────────────────────────────────────────────
//
// A broker can replace a look's accent and ground with their own, so a
// Northrop & Johnson reel comes out navy and an Edmiston one red. Everything
// downstream of the two colours — light/dark handling, text contrast, scrim
// tint — is derived here, so a colour swap never leaves white type on a
// white page.

export type BrandColors = { accent?: string | null; ground?: string | null };

const HEX_RE = /^#?([0-9a-f]{6})$/i;

export function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(HEX_RE);
  return m ? `#${m[1].toLowerCase()}` : null;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Perceived lightness 0..1 (WCAG relative luminance, near enough). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** "rgba(r,g,b,a)" from a hex — for scrims tinted to the ground. */
export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * A look with the broker's colours applied. Text colours follow the ground:
 * a light ground gets ink type and a dark one gets bone, whatever the look
 * started as. The accent is used as given — it's the broker's call.
 */
export function applyBrand(base: ReelStyle, brand: BrandColors | null | undefined): ReelStyle {
  const ground = normalizeHex(brand?.ground) ?? base.ground;
  const accent = normalizeHex(brand?.accent) ?? base.accent;
  if (ground === base.ground && accent === base.accent) return base;
  // Type colours only move when the ground does — a new accent alone must not
  // flatten Classic's warm bone or Cinematic's quieter greys into the generic set.
  const groundChanged = ground !== base.ground;
  const light = groundChanged ? luminance(ground) > 0.3 : base.light;
  return {
    ...base,
    ground,
    accent,
    light,
    ...(groundChanged
      ? {
          text: light ? "#141a21" : "#ffffff",
          soft: light ? "rgba(20,26,33,0.72)" : "rgba(255,255,255,0.84)",
          quiet: light ? "rgba(20,26,33,0.52)" : "rgba(255,255,255,0.62)",
        }
      : {}),
  };
}

/**
 * The colour a logo is "mostly" — the one a designer would pull for the brand.
 *
 * Reads the pixels, throws away anything near white, black or grey (those are
 * paper and ink, not brand), and returns the most common saturated hue. Good
 * enough to land within a shade of the real brand colour nine times out of
 * ten, and the broker can nudge it from there.
 */
export function dominantColor(bmp: ImageBitmap): string | null {
  const c = document.createElement("canvas");
  const size = 64;
  c.width = size; c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  // Bucket by coarse hue; keep a running average per bucket.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.25 || max < 40 || (max > 235 && sat < 0.35)) continue;
    // Hue in 24 steps.
    let h = 0;
    const d = max - min;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = Math.round(((h * 60 + 360) % 360) / 15);
    }
    const bk = buckets.get(h) ?? { n: 0, r: 0, g: 0, b: 0 };
    bk.n++; bk.r += r; bk.g += g; bk.b += b;
    buckets.set(h, bk);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const bk of buckets.values()) if (!best || bk.n > best.n) best = bk;
  if (!best || best.n < 8) return null;
  const to2 = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, "0");
  return `#${to2(best.r)}${to2(best.g)}${to2(best.b)}`;
}

/**
 * Photo categories shot from off the boat. These pull OUT (revealing where she
 * sits); everything inside pushes IN (drawing you aboard). Motion that answers
 * the subject is the difference between a film and a slideshow — and it's a
 * rule, applied the same way every time, rather than per-photo variation.
 */
const EXTERIOR = new Set([
  "profiles", "profiles running", "aerial", "bow", "foredeck", "stern",
  "port", "starboard", "swim platform", "tower", "sun deck", "beach club",
  "cockpit", "aft deck", "flybridge", "enclosed flybridge",
  "enclosed flybridge aft deck", "command deck", "seating",
]);

export function isExterior(category: string | null | undefined): boolean {
  return EXTERIOR.has((category ?? "").trim().toLowerCase());
}

/**
 * The on-screen room caption.
 *
 * Deliberately not shown for "Other" (says nothing) or for exterior beauty
 * shots (a profile shot labelled PROFILES is noise). Off by default in the
 * top-tier styles' spirit — the luxury houses don't label — but on tap for
 * brokers who want a buyer to know exactly which stateroom they're looking at.
 */
export function roomLabel(category: string | null | undefined): string | null {
  const c = (category ?? "").trim();
  if (!c) return null;
  const lower = c.toLowerCase();
  if (lower === "other" || lower === "profiles" || lower === "profiles running") return null;
  return c.toUpperCase();
}
