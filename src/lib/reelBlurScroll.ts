/**
 * Blur scroll (Nov 7) — the reel look where the whole boat goes by.
 *
 * Behind everything, the cover photograph fills the frame, blurred (a
 * gaussian of about 24px at 1080 wide on Medium) and darkened by a quarter,
 * crossfading to another photograph every `bgEvery` seconds — the cover,
 * then up to three more (profiles, running shots and aerials first). Over
 * it the listing's photographs scroll steadily upward on small rounded,
 * softly shadowed cards in a loose masonry: one or two columns, mixed 3:2
 * and 4:5 crops, the second column offset from the first. The layout is
 * random but seeded from the listing and its photographs, so every render
 * of the same selection is identical. Every photograph is shown before any
 * repeats; the strip is as long as the reel needs. The scroll eases to a
 * stop over the last two seconds and dissolves into the end card.
 *
 * Pure drawing helpers — no DOM lookups — so ReelMaker and a local frame
 * check can both call them. ReelMaker owns the timeline (planBlurScroll in
 * @/lib/reelStack) and the bitmaps.
 */

import { seededRandom } from "./reelTransitions";

export type BlurScrollOptions = {
  columns: 1 | 2;
  blur: "low" | "medium" | "high";
  speed: "slow" | "normal" | "fast";
  /** Seconds between background changes. */
  bgEvery: number;
};

export const BLUR_SCROLL_DEFAULTS: BlurScrollOptions = { columns: 2, blur: "medium", speed: "normal", bgEvery: 8 };
/** Offered in the admin builder. */
export const BLUR_SCROLL_BG_CHOICES = [6, 8, 12];

/** Gaussian blur radius at a 1080px-wide frame (scaled with the frame). */
export const BLUR_SCROLL_BLUR_PX: Record<BlurScrollOptions["blur"], number> = { low: 12, medium: 24, high: 40 };
/** Seconds an average card spends on screen, bottom edge to top edge. */
export const BLUR_SCROLL_ON_SCREEN: Record<BlurScrollOptions["speed"], number> = { slow: 4.5, normal: 3, fast: 2.2 };

/** The scroll eases to a stop over this many seconds at the end of its unit. */
export const BLUR_SCROLL_SETTLE = 2;
/** The dissolve from the settled scroll into the end card. */
export const BLUR_SCROLL_END_DISSOLVE = 1.0;
/** The shortest scroll worth making (a reel of one or two photographs). */
export const BLUR_SCROLL_MIN_SEC = 8;
/** Background crossfade length. */
export const BLUR_SCROLL_BG_FADE = 1.5;
/** Darken the blurred background by this much. */
const BG_DARKEN = 0.25;
/** The most photographs the background cycles through. */
const BG_MAX = 4;
const BG_CATEGORIES = ["profiles", "profiles running", "aerial"];

type Img = CanvasImageSource & { width: number; height: number };
type MakeCanvas = (w: number, h: number) => HTMLCanvasElement;

export type ScrollCard = { index: number; x: number; y: number; w: number; h: number };
export type ScrollLayout = {
  cards: ScrollCard[];
  /** Pixels per second while cruising. */
  speed: number;
  margin: number;
  radius: number;
};

/**
 * Lay the strip out. `shapes[i]` is photograph i's width / height (decides
 * whether a 4:5 crop is likely); the strip runs until it covers the whole
 * scroll of a unit `hold` seconds long, plus a screen.
 */
export function layoutBlurScroll(o: {
  shapes: number[]; W: number; H: number; sc: number;
  columns: 1 | 2; speed: BlurScrollOptions["speed"]; hold: number; seed: number;
}): ScrollLayout {
  const { shapes, W, H, sc, hold } = o;
  const n = shapes.length;
  const cols = o.columns === 1 ? 1 : 2;
  const margin = (cols === 2 ? 44 : 120) * sc;
  const gap = 26 * sc;
  const cw = cols === 2 ? (W - margin * 2 - gap) / 2 : W - margin * 2;
  const avgH = cw * ((1 / 1.5 + 1.25) / 2);
  const speed = (H + avgH) / BLUR_SCROLL_ON_SCREEN[o.speed];
  const radius = 16 * sc;
  const cards: ScrollCard[] = [];
  if (n === 0) return { cards, speed, margin, radius };

  const rand = seededRandom(o.seed * 17 + 3);
  const need = scrollOffset(hold + 10, hold, speed) + H + avgH;
  // Column heads. The second column starts half a card higher, so the two
  // never line up across the frame.
  const colY = cols === 2 ? [36 * sc, 36 * sc - avgH * 0.5] : [36 * sc];
  // Play order: the selection as chosen, then seeded reshuffles of it — each
  // pass shows every photograph once, and no photograph follows itself.
  let order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  let k = 0;
  let lastAspect: number[] = [0, 0];
  let guard = 0;
  while (Math.min.apply(null, colY) < need && guard++ < 5000) {
    if (k >= order.length) {
      const prevLast = order[order.length - 1];
      const next = order.slice();
      for (let s = next.length - 1; s > 0; s--) {
        const j = Math.floor(rand() * (s + 1));
        const tmp = next[s]; next[s] = next[j]; next[j] = tmp;
      }
      if (next.length > 1 && next[0] === prevLast) { const tmp = next[0]; next[0] = next[1]; next[1] = tmp; }
      order = next;
      k = 0;
    }
    const index = order[k++];
    // The shorter column takes the next card — that is the masonry.
    let col = 0;
    if (cols === 2 && colY[1] < colY[0]) col = 1;
    // Crop: a portrait photograph usually gets the taller 4:5; a landscape
    // the 3:2 more often than not. Never three of one shape running in a
    // column, so the rhythm stays loose.
    const portrait = (shapes[index] || 1.5) < 1;
    let tall = rand() < (portrait ? 0.8 : 0.4);
    const run = lastAspect[col];
    if (run >= 2 && tall) tall = false;
    else if (run <= -2 && !tall) tall = true;
    lastAspect[col] = tall ? (run > 0 ? run + 1 : 1) : (run < 0 ? run - 1 : -1);
    const h = tall ? cw * 1.25 : cw / 1.5;
    const jitter = (rand() - 0.5) * 12 * sc;
    const x = margin + col * (cw + gap) + (cols === 2 ? jitter : 0);
    cards.push({ index, x, y: colY[col], w: cw, h });
    colY[col] += h + gap * (0.85 + rand() * 0.6);
  }
  return { cards, speed, margin, radius };
}

/**
 * How far the strip has scrolled `t` seconds into a unit of `hold` seconds:
 * steady at `speed`, then easing to a stop over the last BLUR_SCROLL_SETTLE
 * seconds (velocity falling linearly to nothing). Holds still after.
 */
export function scrollOffset(t: number, hold: number, speed: number): number {
  const cruise = Math.max(0, hold - BLUR_SCROLL_SETTLE);
  const tt = Math.max(0, t);
  if (tt <= cruise) return speed * tt;
  const d = Math.min(BLUR_SCROLL_SETTLE, tt - cruise);
  return speed * (cruise + d - (d * d) / (2 * BLUR_SCROLL_SETTLE));
}

/**
 * The photographs the background cycles through: the first (the cover),
 * then up to three profiles / running shots / aerials in selection order,
 * topped up with photographs spread evenly through the selection.
 */
export function blurScrollBackgrounds(categories: (string | null | undefined)[]): number[] {
  const n = categories.length;
  if (n === 0) return [];
  const out = [0];
  for (let i = 1; i < n && out.length < BG_MAX; i++) {
    if (BG_CATEGORIES.indexOf((categories[i] ?? "").trim().toLowerCase()) >= 0) out.push(i);
  }
  for (let step = 1; out.length < Math.min(BG_MAX, n) && step < BG_MAX * 2; step++) {
    const i = Math.min(n - 1, Math.round((n * step) / BG_MAX));
    if (out.indexOf(i) < 0) out.push(i);
  }
  return out;
}

/**
 * Which backgrounds are on screen at `t`: `a` alone, or `a` crossfading to
 * `b` by `mix` in the last BLUR_SCROLL_BG_FADE seconds of each interval.
 * Indices into the background list.
 */
export function backgroundAt(t: number, count: number, every: number): { a: number; b: number; mix: number } {
  if (count <= 1 || every <= 0) return { a: 0, b: 0, mix: 0 };
  const k = Math.max(0, Math.floor(t / every));
  const into = t - k * every;
  const fadeFrom = every - Math.min(BLUR_SCROLL_BG_FADE, every * 0.5);
  const mix = into > fadeFrom ? (into - fadeFrom) / (every - fadeFrom) : 0;
  const sm = mix * mix * (3 - 2 * mix);
  return { a: k % count, b: (k + 1) % count, mix: sm };
}

/** Background change times inside a unit of `hold` seconds — cuts for the music. */
export function backgroundCuts(hold: number, count: number, every: number): number[] {
  const out: number[] = [];
  if (count <= 1 || every <= 0) return out;
  for (let t = every; t < hold - 0.5; t += every) out.push(t);
  return out;
}

/**
 * One blurred, darkened background, built once at a quarter of the frame
 * (the blur is scaled to match, so it reads as `blurPx` at full size) and
 * scaled up when drawn. Where the browser has no canvas filter, a much
 * smaller copy scaled up stands in for the blur.
 */
export function buildBlurBackground(img: Img, W: number, H: number, blurPx: number, makeCanvas: MakeCanvas): HTMLCanvasElement {
  const q = 4;
  const c = makeCanvas(Math.max(1, Math.round(W / q)), Math.max(1, Math.round(H / q)));
  const bctx = c.getContext("2d")!;
  const radius = (blurPx * (W / 1080)) / q;
  const hasFilter = typeof (bctx as unknown as { filter?: unknown }).filter === "string";
  // Overfill a little so the blur never pulls transparent edges in.
  const cover = (w: number, h: number, extra: number) => {
    const s = Math.max(w / img.width, h / img.height) * extra;
    return { dw: img.width * s, dh: img.height * s };
  };
  if (hasFilter) {
    const { dw, dh } = cover(c.width, c.height, 1.12);
    bctx.filter = `blur(${radius.toFixed(2)}px)`;
    bctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    bctx.filter = "none";
  } else {
    const tiny = makeCanvas(Math.max(1, Math.round(c.width / 8)), Math.max(1, Math.round(c.height / 8)));
    const tctx = tiny.getContext("2d")!;
    const { dw, dh } = cover(tiny.width, tiny.height, 1.12);
    tctx.drawImage(img, (tiny.width - dw) / 2, (tiny.height - dh) / 2, dw, dh);
    bctx.imageSmoothingEnabled = true;
    bctx.drawImage(tiny, 0, 0, c.width, c.height);
    tiny.width = 0; tiny.height = 0;
  }
  bctx.fillStyle = `rgba(0,0,0,${BG_DARKEN})`;
  bctx.fillRect(0, 0, c.width, c.height);
  return c;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** One frame of the scroll, `local` seconds into a unit of `hold` seconds. */
export function drawBlurScroll(ctx: CanvasRenderingContext2D, o: {
  W: number; H: number; sc: number; local: number; hold: number; alpha: number; ground: string;
  layout: ScrollLayout;
  /** By selection index. */
  images: (Img | undefined)[];
  backgrounds: HTMLCanvasElement[];
  bgEvery: number;
}) {
  const { W, H, sc, local, hold, alpha, layout } = o;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = o.ground;
  ctx.fillRect(0, 0, W, H);
  if (o.backgrounds.length > 0) {
    const bg = backgroundAt(Math.min(local, hold), o.backgrounds.length, o.bgEvery);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(o.backgrounds[bg.a], 0, 0, W, H);
    if (bg.mix > 0) {
      ctx.globalAlpha = alpha * bg.mix;
      ctx.drawImage(o.backgrounds[bg.b], 0, 0, W, H);
      ctx.globalAlpha = alpha;
    }
  }
  const off = scrollOffset(local, hold, layout.speed);
  for (let c = 0; c < layout.cards.length; c++) {
    const card = layout.cards[c];
    const y = card.y - off;
    if (y > H + 40 * sc) break; // cards are laid out top to bottom per column; past the frame on both, stop
    if (y + card.h < -40 * sc) continue;
    const img = o.images[card.index];
    if (!img) continue;
    // The shadow, on a plate the size of the card.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.42)";
    ctx.shadowBlur = 28 * sc;
    ctx.shadowOffsetY = 10 * sc;
    roundRectPath(ctx, card.x, y, card.w, card.h, layout.radius);
    ctx.fillStyle = o.ground;
    ctx.fill();
    ctx.restore();
    // The photograph, cropped to cover the card.
    ctx.save();
    roundRectPath(ctx, card.x, y, card.w, card.h, layout.radius);
    ctx.clip();
    const s = Math.max(card.w / img.width, card.h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, card.x + (card.w - dw) / 2, y + (card.h - dh) / 2, dw, dh);
    ctx.restore();
  }
  ctx.restore();
}
