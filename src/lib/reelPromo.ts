/**
 * The Reel open house.
 *
 * For two weeks every broker and assistant on the portal gets the Reel tool in
 * full — no watermark, no plan check — whether they're subscribed, on trial, or
 * long lapsed. The reasoning is straightforward: nobody else in yachting has a
 * reel generator at all, and a tool this unusual sells itself far better from
 * the inside than from a feature list. Let them make one for their own boat and
 * put it on Instagram; that's the pitch.
 *
 * Only the Reel opens up. Slideshows, Send to Client, spec sheets and social
 * posts stay exactly as they were — a lapsed broker still sees those locked.
 *
 * TO CHANGE THE DATES: edit the two lines below. They're plain ISO timestamps
 * in UTC; the window closes at the end of the day Eastern.
 */

/** Opens Sept 9 2026, 00:00 ET. */
export const REEL_PROMO_START = "2026-09-09T04:00:00Z";
/**
 * Closes at the end of Sept 30 2026 ET. Pushed out a week on Sept 11 so the
 * announcement could wait for the Stack look — Charlie wanted them to have
 * the polished tool for a full fortnight, not a rolling one.
 */
export const REEL_PROMO_END = "2026-10-01T03:59:59Z";

export function reelPromoActive(now: Date = new Date()): boolean {
  const t = now.getTime();
  return t >= Date.parse(REEL_PROMO_START) && t <= Date.parse(REEL_PROMO_END);
}

/** Whole days remaining, rounded up — 1 means "today is the last day". */
export function reelPromoDaysLeft(now: Date = new Date()): number {
  const ms = Date.parse(REEL_PROMO_END) - now.getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

/** "5 days left" / "Last day" — for banners and email. */
export function reelPromoCountdown(now: Date = new Date()): string {
  const d = reelPromoDaysLeft(now);
  if (d <= 0) return "Closed";
  if (d === 1) return "Last day";
  return `${d} days left`;
}

/** Human date the window closes, e.g. "September 30". */
export function reelPromoEndsOn(): string {
  return new Date(Date.parse(REEL_PROMO_END)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}
