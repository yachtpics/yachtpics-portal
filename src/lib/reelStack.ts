/**
 * The reel's timeline — units and the transitions between them.
 *
 * Every look is the same shape underneath: a list of UNITS (a photograph, a
 * stack run, the end card), each holding for a while, joined by TRANSITIONS
 * from `reelTransitions`. The quiet looks join every unit with a dissolve.
 * Energy and Stack deal from a vocabulary — whip, push, wipe, zoom-through,
 * flash, quick dissolve, dip — so no two consecutive cuts are the same move.
 *
 * Both have an ARC, the thing that makes GoPro's Quik and Apple's Memories
 * feel cut to music: a long open on the hero frame, varied holds, and a long
 * landing on the last photograph. Energy adds a three-photo flash burst at
 * the climax and a short-short-long hold pattern. The Stack — no burst —
 * alternates runs of three horizontal bands (one swapping per beat) with
 * full-frame singles, in lengths that vary from boat to boat, every photo
 * used once.
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

/**
 * Flash-burst frames: each photo held for this long, white flash on the cut.
 *
 * Tuned three times against real boats, always in the same direction. A fifth
 * of a second read as skipping; a third still went by unseen; half a second
 * was readable but the photographs still felt hurried past. Charlie's rule
 * throughout: "we are delivering photos to be seen." Two thirds of a second
 * is the current answer — quick enough to still read as a burst, slow enough
 * that each frame registers as a photograph rather than a flicker.
 */
export const BURST_DT = 0.65;
/** Photos in the burst (after the hero). Fewer if the reel has fewer photos. */
export const BURST_MAX = 3;
/** A reel needs at least this many photos before it earns a burst. */
export const BURST_MIN_PHOTOS = 7;

/** How long a band takes to swap (whip out / whip in). */
export const SWAP_DUR = 0.24;
/** Stagger between the three bands sliding in at the start of a run. */
export const ROW_STAGGER = 0.07;

/** The white flash on a cut: full on the cut frame, gone in a tenth of a second. */
export const FLASH_DUR = 0.1;
export const FLASH_PEAK = 0.85;

/** How a band's photo arrives. Dealt per swap so a run never reads as one repeated move. */
export type BandMove = "left" | "right" | "up" | "down" | "fade" | "wipe";

/** A band fill inside a stack run; `at` is relative to the run's start. */
export type StackEvent = { row: number; index: number; at: number; move: BandMove };

const BAND_MOVES: { move: BandMove; weight: number }[] = [
  { move: "left", weight: 24 },
  { move: "right", weight: 24 },
  { move: "up", weight: 12 },
  { move: "down", weight: 12 },
  { move: "fade", weight: 16 },
  { move: "wipe", weight: 12 },
];

function dealMove(rand: () => number, last: BandMove | null): BandMove {
  const total = BAND_MOVES.reduce((a, m) => a + m.weight, 0);
  for (let tries = 0; tries < 6; tries++) {
    let r = rand() * total;
    let pick = BAND_MOVES[BAND_MOVES.length - 1].move;
    for (const m of BAND_MOVES) { r -= m.weight; if (r <= 0) { pick = m.move; break; } }
    if (pick !== last) return pick;
  }
  return last === "left" ? "right" : "left";
}

/**
 * Which third of the frame a photograph occupies: 0 top, 1 middle, 2 bottom.
 * `null` (or absent) is the ordinary full-frame photograph.
 */
export type Slot = 0 | 1 | 2 | null;

/**
 * One photograph in a WALL — a thirds movement where they arrive one at a
 * time and stay. `arrived` is how many units into the wall this one appeared,
 * so the newest can animate in while the others sit still.
 */
export type PlacedPhoto = {
  slot: 0 | 1 | 2;
  index: number;
  move: BandMove;
  /** Seconds this photograph takes to arrive. Quiet looks fade, slowly. */
  arrive: number;
};

export type Unit =
  | {
      kind: "photo"; index: number; hold: number; burst: boolean;
      /** One-at-a-time placement: which third this photograph occupies. */
      slot?: Slot;
      /**
       * Wall placement: every photograph on screen at this point, oldest
       * first. The LAST is the one arriving; the rest are already settled.
       * When set, `index` is the arriving photograph and `slot` is unused.
       */
      placed?: PlacedPhoto[];
    }
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
const HARD_CUT: Transition = { type: "cut", dur: 0, dir: "left" };

function finish(units: Unit[], transitions: Transition[]): Timeline {
  const starts: number[] = [];
  let t = 0;
  units.forEach((u) => { starts.push(t); t += u.hold; });
  const flashes = transitions.flatMap((tr, k) => (tr.type === "flash" ? [starts[k + 1]] : []));
  return { units, starts, transitions, total: t, flashes };
}

/**
 * The musical hold pattern, as multiples of the look's base hold.
 *
 * What makes an auto-edit feel cut to music isn't the transitions, it's
 * that the holds aren't all the same: short, short, long; short, short,
 * longer. GoPro's Quik and Apple's Memories both do this. Cycled in order —
 * a pattern, not noise.
 */
const HOLD_PATTERN = [0.65, 1.0, 1.3, 0.65, 1.0, 1.6];

/** The last photograph lands and holds — a long, slow pull-back before the card. */
const LANDING_MULT = 1.9;

// ── Thirds ───────────────────────────────────────────────────────────────────
//
// A movement where the frame holds ONE photograph at a time, but never in the
// same place twice: it lands in the top third, leaves, the next arrives in the
// middle or the bottom, leaves, and so on. The empty ground between them is
// the point — it's what makes each photograph read as placed rather than
// played. Cheap to watch and quietly expensive-looking, which is the register
// these brokers are paying for.
//
// It runs in phases, alternating with ordinary full-frame photographs, so a
// film has somewhere to build to and somewhere to rest. Reels only: three
// horizontal bands need the vertical a 9:16 frame has and a 16:9 one doesn't.

/** Photos in one thirds movement. */
const THIRDS_RUN_MIN = 3;
const THIRDS_RUN_MAX = 6;
/** Full-frame photographs between two movements. */
const THIRDS_GAP_MIN = 2;
const THIRDS_GAP_MAX = 3;
/**
 * A thirds photograph is smaller than a full-bleed one, so it needs a moment
 * longer to be read. Just over one — enough to feel placed, not slow.
 */
const THIRDS_HOLD_MULT = 1.15;
/** Below this there aren't enough photographs to spare for a movement. */
const THIRDS_MIN_PHOTOS = 8;
/**
 * The most of a film that may be placed rather than full-bleed.
 *
 * This is the line between a look that HAS a movement and a look that IS one.
 * Editorial is the default — the first thing most brokers will ever render —
 * and at three-fifths placed it stopped reading as Editorial and started
 * reading as a different product. A little over a third leaves the movement
 * as punctuation: enough to notice, not enough to take the look over.
 */
const THIRDS_MAX_FRACTION = 0.4;
/** Photographs in a wall: top, middle, bottom. */
const WALL_ROWS = 3;
/** The completed wall holds longer — three photographs to look at, not one. */
const WALL_COMPLETE_MULT = 1.6;
/**
 * How long a photograph takes to arrive in its third of a wall.
 *
 * Energy whips them in — the move is part of the pace. The quiet looks fade
 * them up instead, and take nearly twice as long about it: a photograph
 * sliding in from the side under a dissolve would argue with the look.
 */
export const WALL_ARRIVE = 0.26;
export const WALL_ARRIVE_QUIET = 0.48;

/**
 * Deal the slots for one movement: never the same third twice running, and
 * never the same one the previous movement finished on.
 */
function dealSlots(n: number, rand: () => number, last: Slot): Slot[] {
  const out: Slot[] = [];
  let prev = last;
  for (let i = 0; i < n; i++) {
    const choices: Slot[] = ([0, 1, 2] as Slot[]).filter((s) => s !== prev);
    const pick = choices[Math.floor(rand() * choices.length)] ?? 0;
    out.push(pick);
    prev = pick;
  }
  return out;
}

/**
 * The single-photo film — every look but the Stack.
 *
 * `vocab` null → dissolves throughout, even holds (the quiet looks). With a
 * vocabulary the film has an ARC: the title photo holds long, the holds
 * then follow the musical pattern, a three-photo flash burst hits at the
 * climax a little past the middle, and the last photograph lands and holds
 * before the end card.
 */
export function planSingles(n: number, opts: {
  titleHold: number; hold: number; endHold: number; dissolve: number;
  burst: boolean;
  /**
   * "energy" deals the full vocabulary, flash included. "stack" deals the same
   * moves without the strobe — what a Stack look falls back to on a 16:9 film,
   * where there is no vertical to stack into but the look's manners still hold.
   */
  vocab: "energy" | "stack" | null;
  /**
   * Run the thirds movement. "single" places one photograph at a time;
   * "wall" has them arrive and stay, three to a wall. Reels only — the
   * caller decides, the planner just lays it out.
   */
  thirds?: "single" | "wall" | null;
  seed: number;
}): Timeline {
  const { titleHold, hold, endHold, dissolve, burst, vocab, seed } = opts;
  // A burst only makes sense with cuts to flash on — never under dissolves.
  const burstN = burst && vocab && n >= BURST_MIN_PHOTOS ? Math.min(BURST_MAX, n - 1) : 0;
  // The burst sits at the climax — just past the middle of the run, never
  // straight after the title (that read as skipping) and never eating the
  // landing shot.
  const burstStart = burstN > 0 ? Math.min(Math.max(2, Math.floor(n * 0.55)), n - 1 - burstN) : n;

  // Lay out the thirds movements first, so the hold loop below knows which
  // photographs are placed and which fill the frame. The title photo, the
  // burst and the landing shot are always full-frame: the opening frame has
  // to sell the boat, the burst is too quick to place, and the film should
  // come to rest on a whole photograph before the card.
  const slots: Slot[] = new Array(n).fill(null);
  // For a wall: every photograph on screen at photo i, oldest first.
  const walls: (PlacedPhoto[] | null)[] = new Array(n).fill(null);
  // Photos joined mid-wall cut straight in; the arrival is animated inside
  // the unit, so a transition here would fade the settled photographs too.
  const hardCuts = new Set<number>();
  const mode = opts.thirds ?? null;

  if (mode && n >= THIRDS_MIN_PHOTOS) {
    const rand = seededRandom(seed * 13 + 5);
    const budget = Math.floor(n * THIRDS_MAX_FRACTION);
    let spent = 0;
    let last: Slot = null;
    let lastMove: BandMove | null = null;
    let i = 1 + THIRDS_GAP_MIN; // let the film open on full frames first
    while (i < n - 1) {
      const room = n - 1 - i;
      const minRun = mode === "wall" ? WALL_ROWS : THIRDS_RUN_MIN;
      if (room < minRun) break;
      if (budget - spent < minRun) break;
      const runN =
        mode === "wall"
          ? WALL_ROWS // a wall is always three: top, middle, bottom
          : Math.min(
              THIRDS_RUN_MIN + Math.floor(rand() * (THIRDS_RUN_MAX - THIRDS_RUN_MIN + 1)),
              room,
              budget - spent
            );
      // A wall must not be split by the burst — it would leave two
      // photographs hanging on screen with a strobe through the middle.
      const clashes = mode === "wall" && burstN > 0 && i < burstStart + burstN && i + runN > burstStart;
      if (clashes) { i = burstStart + burstN; continue; }
      spent += runN;

      if (mode === "wall") {
        // Three thirds in a dealt order, each arriving with its own move.
        const order = ([0, 1, 2] as (0 | 1 | 2)[]).slice();
        for (let s = order.length - 1; s > 0; s--) {
          const j = Math.floor(rand() * (s + 1));
          [order[s], order[j]] = [order[j], order[s]];
        }
        const built: PlacedPhoto[] = [];
        for (let k = 0; k < runN; k++) {
          // A look with no vocabulary dissolves everything else, so its
          // photographs fade into place rather than being thrown there.
          const move: BandMove = vocab ? dealMove(rand, lastMove) : "fade";
          lastMove = move;
          built.push({
            slot: order[k],
            index: i + k,
            move,
            arrive: vocab ? WALL_ARRIVE : WALL_ARRIVE_QUIET,
          });
          // Each unit sees the wall as it stands when that photograph lands.
          walls[i + k] = built.slice();
          if (k > 0) hardCuts.add(i + k);
        }
        last = order[runN - 1];
      } else {
        const dealt = dealSlots(runN, rand, last);
        for (let k = 0; k < runN; k++) {
          const at = i + k;
          // The burst keeps the whole frame — it is a punch, not a placement.
          if (at >= burstStart && at < burstStart + burstN) continue;
          slots[at] = dealt[k];
          last = dealt[k];
        }
      }
      i += runN + THIRDS_GAP_MIN + Math.floor(rand() * (THIRDS_GAP_MAX - THIRDS_GAP_MIN + 1));
    }
  }

  const units: Unit[] = [];
  let pi = 0;
  for (let i = 0; i < n; i++) {
    const inBurst = i >= burstStart && i < burstStart + burstN;
    const wall = walls[i];
    let h: number;
    if (i === 0) h = titleHold;
    else if (inBurst) h = BURST_DT;
    else if (!vocab) h = hold;
    else if (i === n - 1) h = hold * LANDING_MULT;
    else h = hold * HOLD_PATTERN[pi++ % HOLD_PATTERN.length];
    // A placed photograph is smaller, so it gets a little longer to be read.
    if ((slots[i] !== null || wall) && !inBurst && i !== 0) h *= THIRDS_HOLD_MULT;
    // The finished wall earns an extra beat — the point of building it is
    // that all three can be looked at together.
    if (wall && wall.length === WALL_ROWS) h *= WALL_COMPLETE_MULT;
    units.push({ kind: "photo", index: i, hold: h, burst: inBurst, slot: slots[i], placed: wall ?? undefined });
  }
  units.push({ kind: "end", hold: endHold });

  const count = units.length - 1;
  let transitions: Transition[];
  if (!vocab) {
    transitions = Array.from({ length: count }, () => ({ type: "dissolve", dur: dissolve, dir: "left" } as Transition));
    // (A dissolve look never builds walls, so no hard cuts to pin here.)
  } else {
    // Into and out of every burst frame: a flash cut. Into the end card too
    // — the landing resolves on a flash. The rest are dealt. A Stack film
    // gets neither: no burst to flash on, and no strobe on the landing.
    const strobes = vocab === "energy";
    const fixed: Record<number, Transition> = {};
    if (strobes) {
      if (burstN > 0) for (let k = burstStart - 1; k < burstStart + burstN; k++) fixed[k] = FLASH_CUT;
      fixed[count - 1] = FLASH_CUT;
    }
    // Inside a wall: a plain cut. The photographs already on screen must not
    // move, and every transition here draws the whole frame.
    hardCuts.forEach((i) => { if (i - 1 >= 0 && i - 1 < count) fixed[i - 1] = HARD_CUT; });
    transitions = dealTransitions(count, strobes ? ENERGY_VOCAB : STACK_VOCAB, seed, fixed);
  }
  return finish(units, transitions);
}

/**
 * The Stack film.
 *
 * - photo 0: hero with title
 * - movements, alternating: a stack run (three bands whip in, then a few
 *   swaps on the beat) and one or two full-frame singles
 * - the last photograph lands and holds; then the end card
 * Every photograph appears exactly once — the film is as long as the photos
 * make it. No flash burst: Charlie found it too fast for a boat that's
 * meant to be seen.
 */
export function planStack(n: number, opts: { heroHold: number; beat: number; endHold: number; seed: number }): Timeline {
  const { heroHold, beat, endHold, seed } = opts;
  const rand = seededRandom(seed * 7 + 3);
  if (n === 0) return finish([{ kind: "end", hold: endHold }], []);

  const units: Unit[] = [{ kind: "photo", index: 0, hold: heroHold, burst: false }];

  // The deal: the photos after the hero, in tap order, each once. The last
  // one is kept back for the landing.
  const pool: number[] = [];
  for (let i = 1; i < n; i++) pool.push(i);
  let p = 0;
  const left = () => pool.length - p;
  const take = () => pool[p++];
  const rows = 3;

  // A run needs three bands, at least one swap and a landing kept back —
  // six photos. Shorter lists run as full-frame singles.
  const canStack = n >= 6;

  if (n >= 2) {
    let wantStack = canStack;
    let run = 0;
    // Everything but the last photo goes into the movements.
    while (left() > 1) {
      // A run needs three bands and at least one swap; otherwise singles.
      if (wantStack && left() - 1 >= rows + 1) {
        // A run: bands whip in, then three to five swaps (fewer if the list
        // is running out). The bands fill in a rotating order run to run (so
        // no band is always the stale one), and each swap replaces the
        // OLDEST band — at most three consecutive photos on screen, so
        // nothing can double up.
        let swaps = Math.min(3 + Math.floor(rand() * 3), left() - 1 - rows);
        // If what's left after this run couldn't make another run, fold it
        // into this one and leave a single before the landing — better one
        // longer run than a tail of four singles.
        const after = left() - 1 - rows - swaps;
        if (after > 0 && after < rows + 2) swaps = Math.max(swaps, left() - 1 - rows - 1);
        const events: StackEvent[] = [];
        // The bands arrive from alternating sides; every swap after that is
        // dealt its own move, never the same as the one before.
        let last: BandMove | null = null;
        for (let r = 0; r < rows; r++) {
          const move: BandMove = r % 2 === 0 ? "left" : "right";
          events.push({ row: (r + run) % rows, index: take(), at: r * ROW_STAGGER, move });
          last = move;
        }
        for (let k = 0; k < swaps; k++) {
          const move = dealMove(rand, last);
          events.push({ row: (k + run) % rows, index: take(), at: beat * (k + 1), move });
          last = move;
        }
        const hold = beat * (swaps + 1);
        units.push({ kind: "stack", hold, events });
        run++;
        wantStack = false;
      } else {
        // One or two singles — a full-frame breath between runs. A single
        // holds a little longer than a band swap; it's carrying the frame alone.
        const count = Math.min(left() - 1, 1 + (rand() < 0.4 ? 1 : 0));
        for (let c = 0; c < count; c++) {
          const hold = beat * (rand() < 0.5 ? 1.5 : 2);
          units.push({ kind: "photo", index: take(), hold, burst: false });
        }
        wantStack = canStack;
      }
    }
    // The landing: the last photograph full-frame, held long, a slow
    // pull-back — the film comes to rest before the card.
    units.push({ kind: "photo", index: take(), hold: beat * 2.6, burst: false });
  }
  units.push({ kind: "end", hold: endHold });

  const transitions = dealTransitions(units.length - 1, STACK_VOCAB, seed);
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
  return { index: cur.index, since: cur.at, until: next?.at ?? null, prevIndex: prev?.index ?? null, progress: p, move: cur.move };
}

/** Ease-out for the whip — fast off the line, settles hard. */
export function whipEase(p: number) {
  return 1 - Math.pow(1 - p, 3);
}
