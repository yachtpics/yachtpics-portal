/**
 * Does a broker's logo read on a dark background? (Nov 12, 2026)
 *
 * Owner rule: wherever a broker's logo is drawn on a DARK background and it
 * would not read there (dark lettering — e.g. black text beside a silver
 * mark), it sits on a soft light plate. Logos that already read on dark are
 * drawn exactly as uploaded. A broker's logo is never recoloured, inverted or
 * tinted (the logo-stack reel's light-plate silhouette is the one exception).
 *
 * Pure: works on raw RGBA bytes, so the same test runs in the browser (canvas
 * getImageData) and on the server (sharp raw output). Used by the reel end
 * card, logo-stack reel, social post, showroom card, spec sheet, seller
 * report, broker website header and the admin Logo card.
 *
 * Tuned on synthetic images and the real Miles Yacht Group logo (black text +
 * silver mark): ~14% of its opaque area is dark text under 2.2:1 on #050b14,
 * the silver mark is all above 5:1. See scripts/logo_contrast_check.ts.
 */

/** Plate colour — a warm off-white, like a printed label. */
export const LOGO_PLATE_COLOR = "#f6f4ef";
/** Padding on every side, as a share of the LOGO's height. */
export const LOGO_PLATE_PAD = 0.18;
/** Corner radius, as a share of the PLATE's height (min LOGO_PLATE_MIN_RADIUS px). */
export const LOGO_PLATE_RADIUS = 0.12;
export const LOGO_PLATE_MIN_RADIUS = 6;

/** A pixel this opaque or more counts as part of the logo (~40%). */
const ALPHA_MIN = 102;
/** Under this contrast against the background a pixel "doesn't read". */
const MIN_CONTRAST = 2.2;
/** This share of the logo's opaque area not reading → plate. */
const LOW_SHARE = 0.08;
/** A logo whose opaque area covers this much of its box carries its own background. */
const OWN_BOX = 0.9;
/** Backgrounds lighter than this are "light" — never plated (unchanged surfaces). */
const LIGHT_BG = 0.3;
/** Long side of the analysed copy. */
export const LOGO_ANALYSIS_MAX = 96;

export type LogoContrast = {
  needsPlate: boolean;
  /** Opaque pixels / all pixels of the (downsampled) logo box. */
  coverage: number;
  /** Share of the opaque pixels under MIN_CONTRAST against the background. */
  lowShare: number;
  reason: "light-background" | "empty" | "own-background" | "reads" | "dark-lettering";
};

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an sRGB colour. */
export function relLuminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** True when a background colour is dark enough that a logo could vanish on it. */
export function isDarkBackground(bgHex: string): boolean {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return false;
  return relLuminance(rgb[0], rgb[1], rgb[2]) <= LIGHT_BG;
}

/**
 * Box-filter the logo down to ≤ `max` px on the long side. Colour is averaged
 * weighted by alpha (so transparent pixels don't drag it toward black).
 */
export function downsampleRgba(
  rgba: ArrayLike<number>, w: number, h: number, max = LOGO_ANALYSIS_MAX
): { data: Uint8ClampedArray; w: number; h: number } {
  const k = Math.max(w, h) > max ? max / Math.max(w, h) : 1;
  const ow = Math.max(1, Math.round(w * k)), oh = Math.max(1, Math.round(h * k));
  const out = new Uint8ClampedArray(ow * oh * 4);
  if (k === 1) {
    for (let i = 0; i < w * h * 4; i++) out[i] = rgba[i];
    return { data: out, w, h };
  }
  for (let oy = 0; oy < oh; oy++) {
    const y0 = Math.floor((oy * h) / oh), y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * h) / oh));
    for (let ox = 0; ox < ow; ox++) {
      const x0 = Math.floor((ox * w) / ow), x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * w) / ow));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const al = rgba[i + 3];
          r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al; n++;
        }
      }
      const o = (oy * ow + ox) * 4;
      out[o] = a ? r / a : 0;
      out[o + 1] = a ? g / a : 0;
      out[o + 2] = a ? b / a : 0;
      out[o + 3] = n ? a / n : 0;
    }
  }
  return { data: out, w: ow, h: oh };
}

/** The full analysis (numbers included, for tests and the admin card). */
export function analyseLogoContrast(rgba: ArrayLike<number>, w: number, h: number, bgHex: string): LogoContrast {
  const bg = hexToRgb(bgHex);
  if (!bg || w <= 0 || h <= 0) return { needsPlate: false, coverage: 0, lowShare: 0, reason: "empty" };
  const bgL = relLuminance(bg[0], bg[1], bg[2]);
  if (bgL > LIGHT_BG) return { needsPlate: false, coverage: 0, lowShare: 0, reason: "light-background" };

  const small = downsampleRgba(rgba, w, h);
  const d = small.data;
  const total = small.w * small.h;
  let opaque = 0, low = 0;
  for (let i = 0; i < total * 4; i += 4) {
    if (d[i + 3] < ALPHA_MIN) continue;
    opaque++;
    const L = relLuminance(d[i], d[i + 1], d[i + 2]);
    const ratio = (Math.max(L, bgL) + 0.05) / (Math.min(L, bgL) + 0.05);
    if (ratio < MIN_CONTRAST) low++;
  }
  if (opaque === 0) return { needsPlate: false, coverage: 0, lowShare: 0, reason: "empty" };
  const coverage = opaque / total;
  const lowShare = low / opaque;
  // A logo on its own opaque box (a JPEG, a white rectangle) already carries
  // its background; a plate around it would just be a frame.
  if (coverage >= OWN_BOX) return { needsPlate: false, coverage, lowShare, reason: "own-background" };
  if (lowShare >= LOW_SHARE) return { needsPlate: true, coverage, lowShare, reason: "dark-lettering" };
  return { needsPlate: false, coverage, lowShare, reason: "reads" };
}

/** Does this logo need the light plate on this background? */
export function logoNeedsPlate(rgba: ArrayLike<number>, w: number, h: number, bgHex: string): boolean {
  return analyseLogoContrast(rgba, w, h, bgHex).needsPlate;
}

/** Plate geometry around a logo drawn at lw × lh. */
export function logoPlateBox(lw: number, lh: number): { pad: number; w: number; h: number; radius: number } {
  const pad = lh * LOGO_PLATE_PAD;
  const h = lh + pad * 2;
  return { pad, w: lw + pad * 2, h, radius: Math.max(LOGO_PLATE_MIN_RADIUS, h * LOGO_PLATE_RADIUS) };
}

/**
 * The logo size to use when it goes on a plate inside a slot of maxW × maxH:
 * the logo keeps lw × lh unless the plate would overflow, then logo and plate
 * shrink together.
 */
export function fitLogoOnPlate(lw: number, lh: number, maxW: number, maxH: number): { lw: number; lh: number } {
  const box = logoPlateBox(lw, lh);
  const k = Math.min(1, maxW / box.w, maxH / box.h);
  return { lw: lw * k, lh: lh * k };
}
