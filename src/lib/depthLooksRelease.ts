import type { AccessStatus } from "@/lib/subscriptionAccess";

/**
 * When the depth looks (Walkthrough and Underway) open to brokers.
 *
 * Admins have them from the start; subscribers from
 * DEPTH_LOOKS_SUBSCRIBER_OPEN_AT (Mon Oct 5); every other broker from
 * DEPTH_LOOKS_OPEN_AT (Fri Oct 9). From that instant they appear in the
 * reel's look picker and on the help page. Kept apart from the engine
 * (@/lib/depthMotion) so the picker, the help page and the announcement
 * email can all read it without loading any of that.
 *
 * TO CHANGE A DATE: edit the line below. A plain ISO timestamp in UTC.
 * The announcement email and /admin/announce follow DEPTH_LOOKS_OPEN_AT
 * (the general release) only.
 */

/** Friday Oct 9 2026, 9:00 AM Eastern (13:00 UTC). Charlie's call, Oct 2. */
export const DEPTH_LOOKS_OPEN_AT = "2026-10-09T13:00:00Z";

/**
 * Monday Oct 5 2026, 9:00 AM Eastern (13:00 UTC) — subscribers' early access.
 * Charlie's call, Oct 4.
 */
export const DEPTH_LOOKS_SUBSCRIBER_OPEN_AT = "2026-10-05T13:00:00Z";

/**
 * Who counts as a subscriber for the early access: the answer the app
 * already gives everywhere else, getEffectiveAccessStatus (@/lib/brokerAccess
 * — the broker's own plan, or their office plan), taken at "active". That
 * covers a live Stripe subscription (incl. a Stripe checkout trial), an
 * active Office plan covering the broker, and a hand-unlocked (comped)
 * account such as the Miles Yacht Group brokers. It leaves out the invite
 * trial (trial_active / trial_expiring), which hasAccess() would let in —
 * those brokers haven't paid and weren't comped.
 */
export function isDepthLooksSubscriber(status: AccessStatus | null | undefined): boolean {
  return status === "active";
}

export type DepthLooksViewer = { isAdmin: boolean; isSubscriber: boolean };

/**
 * True when this viewer may use the depth looks right now: admins always,
 * subscribers from DEPTH_LOOKS_SUBSCRIBER_OPEN_AT, everyone from
 * DEPTH_LOOKS_OPEN_AT. Same caveat as depthLooksOpen about calling it during
 * a client render.
 */
export function depthLooksOpenFor(who: DepthLooksViewer, now: Date = new Date()): boolean {
  if (who.isAdmin) return true;
  if (depthLooksOpen(now)) return true;
  return who.isSubscriber && now.getTime() >= Date.parse(DEPTH_LOOKS_SUBSCRIBER_OPEN_AT);
}

/** Milliseconds until they open for this viewer (0 once open). */
export function msUntilDepthLooksOpenFor(who: DepthLooksViewer, now: Date = new Date()): number {
  if (depthLooksOpenFor(who, now)) return 0;
  const at = who.isSubscriber ? DEPTH_LOOKS_SUBSCRIBER_OPEN_AT : DEPTH_LOOKS_OPEN_AT;
  return Math.max(0, Date.parse(at) - now.getTime());
}

/**
 * True once the depth looks are open to everyone.
 *
 * In a client component, don't call this during render: the server and the
 * browser can sit on opposite sides of the instant, and React would see two
 * different pickers. Read it in an effect (the ReelMaker does) or on the
 * server only (the help page does).
 */
export function depthLooksOpen(now: Date = new Date()): boolean {
  return now.getTime() >= Date.parse(DEPTH_LOOKS_OPEN_AT);
}

/** Milliseconds until they open (0 once open) — for a timer that flips the picker on the day. */
export function msUntilDepthLooksOpen(now: Date = new Date()): number {
  return Math.max(0, Date.parse(DEPTH_LOOKS_OPEN_AT) - now.getTime());
}
