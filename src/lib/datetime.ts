// Centralized date/time formatting for admin (and other server-rendered) views.
// Server runs in UTC, so timestamps must be pinned to Eastern explicitly.
// NOTE: only use these for true timestamps (timestamptz columns like sent_at,
// created_at, downloaded_at). Do NOT use them for calendar DATE columns such as
// shoot_date — applying a timezone to a date-only value can shift it a day.

/** The business timezone: YachtPics and nearly all its brokers are in Florida. */
export const BUSINESS_TZ = "America/New_York";
const TZ = BUSINESS_TZ;

/** Date + time in Eastern, e.g. "Jun 17, 2026, 2:30 PM EDT". */
export function formatDateTimeET(value: string | number | Date): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZone: TZ, timeZoneName: "short",
  });
}

/** Date only, in Eastern, e.g. "Jun 17, 2026". */
export function formatDateET(
  value: string | number | Date,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }
): string {
  return new Date(value).toLocaleDateString("en-US", { ...opts, timeZone: TZ });
}

/**
 * The Eastern calendar day of a timestamp as YYYY-MM-DD — for bucketing by
 * day. A view at 00:30 UTC Nov 11 is 7:30 / 8:30 PM Nov 10 in Eastern, so it
 * lands on "2026-11-10". DST is handled by Intl.
 */
export function dayKeyET(value: string | number | Date = new Date()): string {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: TZ });
}

/** A YYYY-MM-DD day key plus n days (calendar arithmetic, no timezone drift). */
export function addDaysToKey(key: string, n: number): string {
  const d = new Date(key + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Format a YYYY-MM-DD day key (already an Eastern day, e.g. from dayKeyET)
 * without shifting it: read at noon UTC and printed in UTC, so the browser's
 * or the server's own timezone can't move it to the day before.
 */
export function formatDayKey(
  key: string,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
): string {
  return new Date(key + "T12:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}
