/**
 * The Reel Maker's photo selection against a changing photo cap.
 *
 * The rule: a trim the APP makes (a shorter Length, or Film's smaller cap) is
 * only a view of the broker's choice, not a new choice. We remember the
 * selection as it was before the trim (`before`) and what the trim left
 * (`after`). The next time the cap changes, if the selection is still exactly
 * what that trim left, we fit the remembered selection instead — so Short then
 * Full brings the 27 photos back, in their order, up to the new cap.
 *
 * Anything the broker does by hand (tap a photo in or out, "First N", Clear,
 * add a clip) makes the selection differ from `after`, and the memory is then
 * ignored: the broker's new selection is the choice, and nothing they took out
 * comes back. The Reel Maker also drops the memory explicitly on those actions.
 */
export interface TrimMemory {
  /** The selection before the app trimmed it, in order. */
  before: string[];
  /** What the trim left — the selection the app set. */
  after: string[];
}

function sameIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The remembered selection, if the current one is still what the trim left. */
export function liveMemory(current: string[], memory: TrimMemory | null): TrimMemory | null {
  return memory && sameIds(memory.after, current) ? memory : null;
}

/**
 * Fit the selection to a new cap. Returns the selection to show and the memory
 * to keep (null when nothing had to be left out).
 */
export function fitSelectionToCap(
  current: string[],
  cap: number,
  memory: TrimMemory | null,
): { chosen: string[]; memory: TrimMemory | null } {
  const live = liveMemory(current, memory);
  const base = live ? live.before : current;
  const chosen = base.length > cap ? base.slice(0, Math.max(0, cap)) : base.slice();
  return { chosen, memory: chosen.length < base.length ? { before: base.slice(), after: chosen.slice() } : null };
}
