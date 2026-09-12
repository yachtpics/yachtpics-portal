/**
 * The Stack look's timeline — and the flash-burst hook the Energy look shares.
 *
 * Both are the grammar of a fast boat's reel in 2026: a hero frame with the
 * name, a burst of near-subliminal cuts to grab the thumb, then a steady beat
 * of hard cuts. The Stack adds the three-band layout — three landscape
 * photographs at once, one band swapping per beat — and breaks it up: runs
 * of the stack alternate with full-frame singles, in lengths that vary from
 * boat to boat, so the frame keeps changing shape and never settles into a
 * pattern the eye can predict.
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

/**
 * A movement of the film after the burst: either a run of the three-band
 * stack, or a single photograph full-frame. They alternate, in varying
 * lengths, so the frame keeps changing shape — a stack that never breaks
 * reads as a template.
 */
export type StackPhase =
  | { kind: "stack"; start: number; end: number; events: StackEvent[] }
  | { kind: "single"; start: number; end: number; index: number; hold: number };

export type StackPlan = {
  /** Full-bleed hero photo (index 0) with the title, from t=0. */
  heroHold: number;
  /** Flash-burst photos, in order, each starting at `start`. */
  burst: { index: number; start: number }[];
  /** When the first movement after the burst begins. */
  stackStart: number;
  /** Seconds between band swaps. */
  beat: number;
  /** The movements, in time order, back to back. */
  phases: StackPhase[];
  /** When the end card cuts in. */
  endStart: number;
  /** Total running time. */
  total: number;
  /** Every hard cut that gets a flash. */
  flashes: number[];
};

/**
 * A tiny deterministic generator — the rhythm varies from boat to boat but
 * the same boat with the same photos renders the same film every time,
 * which is what a broker expects when they press the button twice.
 */
function rng(seed: number) {
  let x = (seed * 2654435761 + 12345) >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

/**
 * Lay out a Stack reel for `n` photos in tap order.
 *
 * - photo 0: hero with title
 * - photos 1..BURST_MAX: the flash burst (skipped on a short list)
 * - then movements, alternating: a stack run (three bands whip in, then
 *   three to five swaps on the beat) and one or two full-frame singles
 *   (punch-in, flash on the cut). Every remaining photo appears once.
 */
export function planStack(n: number, opts: { heroHold: number; beat: number; endHold: number }): StackPlan {
  const { heroHold, beat, endHold } = opts;
  const flashes: number[] = [];
  const rand = rng(n * 7 + 3);

  // Burst.
  const burstN = n >= BURST_MIN_PHOTOS ? Math.min(BURST_MAX, n - 1) : 0;
  const burst: { index: number; start: number }[] = [];
  for (let k = 0; k < burstN; k++) {
    const start = heroHold + k * BURST_DT;
    burst.push({ index: 1 + k, start });
    flashes.push(start);
  }
  const stackStart = heroHold + burstN * BURST_DT;

  // The deal: the photos after the burst, in tap order, and when they run
  // out the list comes round again — hero and burst photos included, so a
  // shot glimpsed for a fifth of a second gets its full-frame moment later.
  // A photograph appearing twice, once as a band and once full-frame, is
  // how these reels are cut; a film that stops the moment every photo has
  // been used once is over before the feed has decided to keep it.
  const pool: number[] = [];
  for (let i = 1 + burstN; i < n; i++) pool.push(i);
  for (let i = 0; i <= burstN && i < n; i++) pool.push(i);
  let p = 0;
  const take = () => pool[p++ % pool.length];
  const rows = 3;

  // How long the movements run: a beat per photo with a floor, so a short
  // list still gets a real film and a long one gets longer, smoothly.
  const target = beat * Math.max(8, n);

  const phases: StackPhase[] = [];
  let t = stackStart;
  // Fewer than four photos can't stack without a band repeating a photo
  // its neighbour is showing; those lists run as full-frame singles.
  const canStack = n >= 4;
  if (n >= 2) {
    // Open on the stack — that's the look's signature — then alternate.
    let wantStack = canStack;
    let run = 0;
    while (t < stackStart + target) {
      if (wantStack) {
        // A run: bands whip in, then three to five swaps. The bands fill in
        // a rotating order run to run (so no band is always the stale one),
        // and each swap replaces the OLDEST band — that keeps at most three
        // consecutive photos on screen, so nothing can double up.
        const swaps = 3 + Math.floor(rand() * 3);
        const events: StackEvent[] = [];
        for (let r = 0; r < rows; r++) events.push({ row: (r + run) % rows, index: take(), at: t + r * ROW_STAGGER });
        for (let k = 0; k < swaps; k++) events.push({ row: (k + run) % rows, index: take(), at: t + beat * (k + 1) });
        const end = t + beat * (swaps + 1);
        flashes.push(t);
        phases.push({ kind: "stack", start: t, end, events });
        t = end;
        run++;
        wantStack = false;
      } else {
        // One or two singles — a full-frame breath between runs. A single
        // holds a little longer than a band swap; it's carrying the frame alone.
        const count = 1 + (rand() < 0.4 ? 1 : 0);
        for (let c = 0; c < count; c++) {
          const hold = beat * (rand() < 0.5 ? 1.5 : 2);
          flashes.push(t);
          phases.push({ kind: "single", start: t, end: t + hold, index: take(), hold });
          t += hold;
        }
        wantStack = canStack;
      }
    }
  }

  const endStart = t;
  flashes.push(endStart);
  return { heroHold, burst, stackStart, beat, phases, endStart, total: endStart + endHold, flashes };
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
  let next: StackEvent | null = null;
  for (const e of events) {
    if (e.row !== row) continue;
    if (e.at > t) { if (!next) next = e; continue; }
    prev = cur;
    cur = e;
  }
  if (!cur) return null;
  const p = Math.min(1, (t - cur.at) / SWAP_DUR);
  // `until`: when this band next swaps — the photo's real lifetime, so its
  // drift can be paced to finish just as it leaves. null = end of the run.
  return { index: cur.index, since: cur.at, until: next?.at ?? null, prevIndex: prev?.index ?? null, progress: p };
}

/** Ease-out for the whip — fast off the line, settles hard. */
export function whipEase(p: number) {
  return 1 - Math.pow(1 - p, 3);
}
