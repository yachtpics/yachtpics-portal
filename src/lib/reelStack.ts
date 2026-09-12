/**
 * The reel's timeline — units and the transitions between them.
 *
 * Every look is the same shape underneath: a list of UNITS (a photograph, a
 * stack run, the end card), each holding for a while, joined by TRANSITIONS
 * from `reelTransitions`. The quiet looks join every unit with a dissolve.
 * Energy and Stack deal from a vocabulary — whip, push, wipe, zoom-through,
 * flash, quick dissolve, dip — so no two consecutive cuts are the same move.
 *
 * Both also open the same way: a hero frame with the name, then a burst of
 * near-subliminal flash cuts to stop the thumb. The Stack then alternates
 * runs of three horizontal bands (one swapping per beat) with full-frame
 * singles, in lengths that vary from boat to boat.
 *
 * Everything is timed to a 120 BPM grid (0.5s per beat). No audio is baked
 * in — the broker adds a track when they post — but most trending tracks
 * sit between 100 and 130 BPM, so cuts on this grid land near the beat more
 * often than not.
 *
 * Pure functions: the page's duration readout and the renderer both call
 * these, so they can't disagree about how long the film is.
 */

import {
  dealTransitions, seededRandom, ENERGY_VOCAB, STACK_VOCAB,
  type Transition,
} from "./reelTransitions";

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
/** Stagger between the three bands sliding in at the start of a run. */
export const ROW_STAGGER = 0.07;

/** The white flash on a cut: full on the cut frame, gone in a tenth of a second. */
export const FLASH_DUR = 0.1;
export const FLASH_PEAK = 0.85;

/** A band fill inside a stack run; `at` is relative to the run's start. */
export type StackEvent = { row: number; index: number; at: number };

export type Unit =
  | { kind: "photo"; index: number; hold: number; burst: boolean }
  | { kind: "stack"; hold: number; events: StackEvent[] }
  | { kind: "end"; hold: number };

export type Timeline = {
  units: Unit[];
  /** When each unit's hold begins. The transition INTO unit k plays from starts[k]. */
  starts: number[];
  /** transitions[k] joins unit k to unit k+1. Length units.length - 1. */
  transitions: Transition[];
  total: number;
  /** Every cut that gets a white flash. */
  flashes: number[];
};

const FLASH_CUT: Transition = { type: "flash", dur: 0, dir: "left" };

function finish(units: Unit[], transitions: Transition[]): Timeline {
  const starts: number[] = [];
  let t = 0;
  units.forEach((u) => { starts.push(t); t += u.hold; });
  const flashes = transitions.flatMap((tr, k) => (tr.type === "flash" ? [starts[k + 1]] : []));
  return { units, starts, transitions, total: t, flashes };
}

/**
 * The single-photo film — every look but the Stack.
 *
 * `vocab` null → dissolves throughout (the quiet looks). With a vocabulary,
 * the transitions are dealt; with `burst`, the four photos after the title
 * flash past at a fifth of a second each.
 */
export function planSingles(n: number, opts: {
  titleHold: number; hold: number; endHold: number; dissolve: number;
  burst: boolean; vocab: "energy" | null; seed: number;
}): Timeline {
  const { titleHold, hold, endHold, dissolve, burst, vocab, seed } = opts;
  const burstN = burst && n >= BURST_MIN_PHOTOS ? Math.min(BURST_MAX, n - 1) : 0;
  const units: Unit[] = [];
  for (let i = 0; i < n; i++) {
    const inBurst = i >= 1 && i <= burstN;
    units.push({ kind: "photo", index: i, hold: i === 0 ? titleHold : inBurst ? BURST_DT : hold, burst: inBurst });
  }
  units.push({ kind: "end", hold: endHold });

  const count = units.length - 1;
  let transitions: Transition[];
  if (!vocab) {
    transitions = Array.from({ length: count }, () => ({ type: "dissolve", dur: dissolve, dir: "left" } as Transition));
  } else {
    // Into and out of every burst frame: a flash cut. The rest are dealt.
    const fixed: Record<number, Transition> = {};
    for (let k = 0; k <= burstN && burstN > 0; k++) fixed[k] = FLASH_CUT;
    transitions = dealTransitions(count, ENERGY_VOCAB, seed, fixed);
  }
  return finish(units, transitions);
}

/**
 * The Stack film.
 *
 * - photo 0: hero with title
 * - photos 1..BURST_MAX: the flash burst (skipped on a short list)
 * - then movements, alternating: a stack run (three bands whip in, then
 *   three to five swaps on the beat) and one or two full-frame singles. The
 *   deal cycles through the photos so the film runs to `beat × max(8, n)`
 *   — a shot seen as a band and later full-frame is how these are cut.
 */
export function planStack(n: number, opts: { heroHold: number; beat: number; endHold: number; seed: number }): Timeline {
  const { heroHold, beat, endHold, seed } = opts;
  const rand = seededRandom(seed * 7 + 3);

  const burstN = n >= BURST_MIN_PHOTOS ? Math.min(BURST_MAX, n - 1) : 0;
  const units: Unit[] = [{ kind: "photo", index: 0, hold: heroHold, burst: false }];
  for (let k = 0; k < burstN; k++) units.push({ kind: "photo", index: 1 + k, hold: BURST_DT, burst: true });

  // The deal: the photos after the burst, then round again with the hero
  // and burst photos, so a shot glimpsed for a fifth of a second gets its
  // full-frame moment later.
  const pool: number[] = [];
  for (let i = 1 + burstN; i < n; i++) pool.push(i);
  for (let i = 0; i <= burstN && i < n; i++) pool.push(i);
  let p = 0;
  const take = () => pool[p++ % pool.length];
  const rows = 3;

  // Fewer than four photos can't stack without a band repeating a photo
  // its neighbour is showing; those lists run as full-frame singles.
  const canStack = n >= 4;
  const target = beat * Math.max(8, n);
  let elapsed = 0;
  const fixed: Record<number, Transition> = {};
  // Into and out of every burst frame: flash cuts. Into the first movement too.
  for (let k = 0; k <= burstN && burstN > 0; k++) fixed[k] = FLASH_CUT;

  if (n >= 2) {
    let wantStack = canStack;
    let run = 0;
    while (elapsed < target) {
      if (wantStack) {
        // A run: bands whip in, then three to five swaps. The bands fill in
        // a rotating order run to run (so no band is always the stale one),
        // and each swap replaces the OLDEST band — at most three consecutive
        // photos on screen, so nothing can double up.
        const swaps = 3 + Math.floor(rand() * 3);
        const events: StackEvent[] = [];
        for (let r = 0; r < rows; r++) events.push({ row: (r + run) % rows, index: take(), at: r * ROW_STAGGER });
        for (let k = 0; k < swaps; k++) events.push({ row: (k + run) % rows, index: take(), at: beat * (k + 1) });
        const hold = beat * (swaps + 1);
        units.push({ kind: "stack", hold, events });
        elapsed += hold;
        run++;
        wantStack = false;
      } else {
        // One or two singles — a full-frame breath between runs. A single
        // holds a little longer than a band swap; it's carrying the frame alone.
        const count = 1 + (rand() < 0.4 ? 1 : 0);
        for (let c = 0; c < count; c++) {
          const hold = beat * (rand() < 0.5 ? 1.5 : 2);
          units.push({ kind: "photo", index: take(), hold, burst: false });
          elapsed += hold;
        }
        wantStack = canStack;
      }
    }
  }
  units.push({ kind: "end", hold: endHold });
  // Into the end card: always a flash.
  fixed[units.length - 2] = FLASH_CUT;

  const transitions = dealTransitions(units.length - 1, STACK_VOCAB, seed, fixed);
  return finish(units, transitions);
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
 * The state of one band at time `t` (relative to the run's start): which
 * photo is in it, which one is on its way out, how far through the swap it
 * is (1 = settled), and when it next swaps (null = end of the run).
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
  return { index: cur.index, since: cur.at, until: next?.at ?? null, prevIndex: prev?.index ?? null, progress: p };
}

/** Ease-out for the whip — fast off the line, settles hard. */
export function whipEase(p: number) {
  return 1 - Math.pow(1 - p, 3);
}
