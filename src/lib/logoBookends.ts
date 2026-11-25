/**
 * "Open and close with our logo" — logo bookends (Nov 25, 2026). Browser-safe.
 *
 * An office (brokerage) or a solo broker sets an OPENING logo image, a CLOSING
 * logo image and a BACKGROUND colour. A bookend frame is the logo centred on
 * the solid colour, nothing else. With it on, every reel made for that broker
 * starts on the opening frame and ends on the closing frame (outside the
 * photos — caps, holds and budgets are untouched; the reel simply runs about
 * three and a half seconds longer), and the buyer slideshow opens on the
 * opening frame (2 s, tap to skip) and ends on the closing frame after the
 * last photo. The office setting wins for every broker in the brokerage.
 *
 * Server side (who has what, saving): src/lib/logoBookendsServer.ts.
 * Migration: supabase/migrations/20261125c_logo_bookends.sql.
 */

import { downsampleRgba, hexToRgb, relLuminance } from "@/lib/logoContrast";

export type LogoBookends = { openUrl: string; closeUrl: string; ground: string };

/** The opening frame holds solid this long on a reel (its dissolve follows). */
export const BOOKEND_OPEN_SEC = 1.5;
/** The closing frame holds solid this long on a reel, after its dissolve in. */
export const BOOKEND_CLOSE_SEC = 1.5;
/** The slideshow's opening frame stays this long once the logo has loaded. */
export const SLIDESHOW_OPEN_MS = 2000;
/** Hard cap on the slideshow opener, from mount, whatever happens. */
export const SLIDESHOW_OPEN_CAP_MS = 2600;

/** A logo this much wider than tall is a horizontal (wordmark) lockup. */
export const BOOKEND_WIDE_ASPECT = 2.5;

/**
 * Where the logo sits in a W × H bookend frame, for a logo of lw × lh.
 *
 * Horizontal marks (aspect ≥ 1.8) may run to 76% of the frame width — but
 * never wider than 76% of 1.25 × H, so a 16:9 film doesn't get a logo the
 * width of a billboard — and 58% of the short side tall. Stacked marks sit in
 * a square box 58% of the short side. Contain-scaled, centred exactly.
 */
export function bookendLogoRect(W: number, H: number, lw: number, lh: number): { x: number; y: number; w: number; h: number } {
  const short = Math.min(W, H);
  if (!(lw > 0) || !(lh > 0) || !(W > 0) || !(H > 0)) return { x: W / 2, y: H / 2, w: 0, h: 0 };
  const aspect = lw / lh;
  let maxW: number, maxH: number;
  if (aspect >= BOOKEND_WIDE_ASPECT) {
    maxW = 0.76 * Math.min(W, 1.25 * H);
    maxH = 0.58 * short;
  } else {
    maxW = 0.58 * short;
    maxH = 0.58 * short;
  }
  const k = Math.min(maxW / lw, maxH / lh);
  const w = lw * k, h = lh * k;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/** Under this contrast against the colour a logo pixel "doesn't read". */
const BOOKEND_MIN_CONTRAST = 2.2;
/** A pixel this opaque or more counts as part of the logo (~40%). */
const BOOKEND_ALPHA_MIN = 102;
/** This share of the logo not reading → a gentle warning. */
const BOOKEND_LOW_SHARE = 0.3;

/**
 * Would this logo be hard to see on this colour? Pure (raw RGBA bytes), so it
 * runs on a canvas's getImageData. Unlike the dark-background plate test in
 * logoContrast.ts this works both ways: a white mark on a pale colour warns
 * as readily as a navy mark on navy. A logo that carries its own opaque box
 * (a JPEG) never warns — its box is what shows.
 */
export function bookendLogoHardToSee(rgba: ArrayLike<number>, w: number, h: number, groundHex: string): boolean {
  const bg = hexToRgb(groundHex);
  if (!bg || w <= 0 || h <= 0) return false;
  const bgL = relLuminance(bg[0], bg[1], bg[2]);
  const small = downsampleRgba(rgba, w, h);
  const d = small.data;
  const total = small.w * small.h;
  let opaque = 0, low = 0;
  for (let i = 0; i < total * 4; i += 4) {
    if (d[i + 3] < BOOKEND_ALPHA_MIN) continue;
    opaque++;
    const L = relLuminance(d[i], d[i + 1], d[i + 2]);
    const ratio = (Math.max(L, bgL) + 0.05) / (Math.min(L, bgL) + 0.05);
    if (ratio < BOOKEND_MIN_CONTRAST) low++;
  }
  if (opaque === 0) return false;
  if (opaque / total >= 0.9) return false;
  return low / opaque >= BOOKEND_LOW_SHARE;
}
