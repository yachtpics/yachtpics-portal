/**
 * The Stack look's timeline — and the flash-burst hook the Energy look shares.
 *
 * Both are the grammar of a fast boat's reel in 2026: a hero frame with the
 * name, a burst of near-subliminal cuts to grab the thumb, then a steady beat
 * of hard cuts. The Stack adds the three-band layout — every landscape
 * photograph shown whole, one band swapping per beat, so the frame is never
 * empty and there are always three views of the boat on screen.
 *
 * Everything is timed to a 120 BPM grid (0.5s per beat). No audio is baked
 * in — the broker adds a track when they post — but most trending tracks sit
 * between 100 and 130 BPM, so cuts on this grid land near the beat more
 * often than not.
 *
 * Pure functions: the page's duration readout and the renderer both call
 * `planStack`, so they can't disagree about how long the film is.
 */

/** One beat at 120 BPM. */
export const BEAT = 0.5;

/** Flash-burst frames: each photo held for this long, white flash on the cut. */
export const BURST_DT = 0.2;
/** Photos in the burst (after the hero). Fewer if the reel has fewer photos. */
export const BURST_MAX = 4;
/** A reel needs at least this many photos before it earns a burst. */
export const BURST_MIN_PHOTOS = 7;

/** How long a band takes to swap (whip out / whip in). */
export const SWAP_DUR = 0.24;
/** Stagger between the three bands sliding in at the start of the stack. */
export const ROW_STAGGER = 0.07;

/** The white flash on a cut: full on the cut frame, gone in a tenth of a second. */
export const FLASH_DUR = 0.1;
export const FLASH_PEAK = 0.85;

export type StackEvent = { row: number; index: number; at: number };

export type StackPlan = {
  /** Full-bleed hero photo (index 0) with the title, from t=0. */
  heroHold: number;
  /** Flash-burst photos, in order, each starting at `start`. */
  burst: { index: number; start: number }[];
  /** When the three bands slide in. */
  stackStart: number;
  /** Seconds between band swaps. */
  beat: number;
  /** Every band fill, including the first three, in time order. */
  events: StackEvent[];
  /** When the end card cuts in. */
  endStart: number;
  /** Total running time. */
  total: number;
  /** Every hard cut that gets a flash. */
  flashes: number[];
};

/**
 * Lay out a Stack reel for `n` photos in tap order.
 *
 * - photo 0: hero with title
 * - photos 1..BURST_MAX: the flash burst (skipped on a short list)
 * - the rest fill the three bands, then the list wraps so the stack keeps
 *   moving until every photo has been in a band at least once.
 */
export function planStack(n: number, opts: { heroHold: number; beat: number; endHold: number }): StackPlan {
  const { heroHold, beat, endHold } = opts;
  const flashes: number[] = [];

  // Burst.
  const burstN = n >= BURST_MIN_PHOTOS ? Math.min(BURST_MAX, n - 1) : 0;
  const burst: { index: number; start: number }[] = [];
  for (let k = 0; k < burstN; k++) {
    const start = heroHold + k * BURST_DT;
    burst.push({ index: 1 + k, start });
    flashes.push(start);
  }
  const stackStart = heroHold + burstN * BURST_DT;
  flashes.push(stackStart);

  // The bands. Photos are dealt in tap order from wherever the burst left
  // off, wrapping past the end (and past the hero) so the stack never runs
  // dry. Enough swaps that every photo has had a band.
  const pool: number[] = [];
  for (let i = 1 + burstN; i < n; i++) pool.push(i);
  for (let i = 0; i <= burstN && i < n; i++) pool.push(i);
  if (pool.length === 0) pool.push(0);
  const at = (i: number) => pool[((i % pool.length) + pool.length) % pool.length];

  // Always three bands — a short list wraps to fill them rather than leaving
  // a third of the frame as bare ground.
  const rows = 3;
  const events: StackEvent[] = [];
  for (let r = 0; r < rows; r++) events.push({ row: r, index: at(r), at: stackStart + r * ROW_STAGGER });
  // Swaps: one per beat, round-robin through the bands, until every photo
  // has had a band. The deal is offset by one so a band is never handed the
  // photo it's already showing (with three photos, a straight round-robin
  // would swap each one with itself).
  const swaps = Math.max(rows, pool.length);
  for (let k = 0; k < swaps; k++) {
    events.push({ row: k % rows, index: at(rows + 1 + k), at: stackStart + beat * (k + 1) });
  }
  const endStart = stackStart + beat * (swaps + 1);
  flashes.push(endStart);

  return { heroHold, burst, stackStart, beat, events, endStart, total: endStart + endHold, flashes };
}

/** White-flash strength at time `t` given the cut times. */
export function flashAlpha(t: number, cuts: number[]): number {
  let a = 0;
  for (const c of cuts) {
    const d = t - c;
    if (d >= 0 && d < FLASH_DUR) a = Math.max(a, FLASH_PEAK * (1 - d / FLASH_DUR));
  }
  return a;
}

/**
 * The state of one band at time `t`: which photo is in it, which one is on
 * its way out, and how far through the swap it is (1 = settled).
 */
export function rowState(events: StackEvent[], row: number, t: number) {
  let cur: StackEvent | null = null;
  let prev: StackEvent | null = null;
  for (const e of events) {
    if (e.row !== row || e.at > t) continue;
    prev = cur;
    cur = e;
  }
  if (!cur) return null;
  const p = Math.min(1, (t - cur.at) / SWAP_DUR);
  return { index: cur.index, since: cur.at, prevIndex: prev?.index ?? null, progress: p };
}

/** Ease-out for the whip — fast off the line, settles hard. */
export function whipEase(p: number) {
  return 1 - Math.pow(1 - p, 3);
}
