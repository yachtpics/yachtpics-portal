// Centralized date/time formatting for admin (and other server-rendered) views.
// Server runs in UTC, so timestamps must be pinned to Eastern explicitly.
// NOTE: only use these for true timestamps (timestamptz columns like sent_at,
// created_at, downloaded_at). Do NOT use them for calendar DATE columns such as
// shoot_date — applying a timezone to a date-only value can shift it a day.

const TZ = "America/New_York";

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
