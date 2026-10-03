/**
 * When the depth looks (Walkthrough and Underway) open to every broker.
 *
 * Admins have them from the start; brokers see them in the reel's look
 * picker — and on the help page — from this instant. Kept apart from the
 * engine (@/lib/depthMotion) so the picker, the help page and the
 * announcement email can all read it without loading any of that.
 *
 * TO CHANGE THE DATE: edit the line below. A plain ISO timestamp in UTC.
 */

/** Friday Oct 9 2026, 9:00 AM Eastern (13:00 UTC). Charlie's call, Oct 2. */
export const DEPTH_LOOKS_OPEN_AT = "2026-10-09T13:00:00Z";

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
