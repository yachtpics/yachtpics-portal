/**
 * Broker contact extras (Oct 28) — client-safe helpers shared by Invite
 * Broker, the admin contact editor, the broker's own profile and the APIs.
 *
 *   phone             shown as "Mobile" (column unchanged)
 *   office_phone      "Office phone"
 *   instagram_handle  bare handle, lowercase, [a-z0-9._], ≤ 30 — shown "@name"
 *   facebook_url      full https://www.facebook.com/… URL
 *   birthday_month/day  no year, ever; both or neither
 *
 * Private admin notes are NOT here on purpose: they live in
 * broker_admin_notes and are only ever read/written by admin-gated server
 * code with the service role.
 */

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(month: number): number {
  return DAYS_IN_MONTH[month - 1] ?? 31;
}

/** "@Name", "name", "instagram.com/name/", "https://www.instagram.com/name?igsh=…" → "name"; "" → null; invalid → undefined. */
export function normalizeInstagram(raw: unknown): string | null | undefined {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, "").replace(/^(www\.)?instagram\.com\//i, "");
  s = s.split(/[/?#]/)[0].replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(s)) return undefined;
  return s;
}

/** A Facebook URL or page name → "https://www.facebook.com/…"; "" → null; invalid → undefined. */
export function normalizeFacebook(raw: unknown): string | null | undefined {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, "").replace(/^(www\.|m\.|web\.)?(facebook\.com|fb\.com)\//i, "");
  s = s.replace(/^@+/, "").replace(/\/+$/, "");
  if (!s || /\s/.test(s) || s.length > 200 || !/^[A-Za-z0-9._\-/?=&%]+$/.test(s)) return undefined;
  return `https://www.facebook.com/${s}`;
}

/** Validate a month/day pair: both or neither. Returns the pair, null for neither, undefined if invalid. */
export function normalizeBirthday(monthRaw: unknown, dayRaw: unknown): { month: number; day: number } | null | undefined {
  const m = monthRaw === "" || monthRaw == null ? null : Number(monthRaw);
  const d = dayRaw === "" || dayRaw == null ? null : Number(dayRaw);
  if (m == null && d == null) return null;
  if (m == null || d == null) return undefined;
  if (!Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > daysInMonth(m)) return undefined;
  return { month: m, day: d };
}

/** "March 14" */
export function formatBirthday(month: number | null | undefined, day: number | null | undefined): string | null {
  if (!month || !day || month < 1 || month > 12) return null;
  return `${MONTHS[month - 1]} ${day}`;
}

export function instagramUrl(handle: string): string {
  return `https://www.instagram.com/${handle}`;
}

/**
 * Validate the optional contact extras from a request body. Only keys present
 * in `body` are returned (so callers can do partial updates). Errors are
 * friendly sentences for the form.
 */
export function cleanContactExtras(body: Record<string, unknown>): { update: Record<string, unknown>; error: string | null } {
  const update: Record<string, unknown> = {};
  if ("officePhone" in body) {
    update.office_phone = typeof body.officePhone === "string" ? body.officePhone.trim().slice(0, 40) || null : null;
  }
  if ("instagram" in body) {
    const ig = normalizeInstagram(body.instagram);
    if (ig === undefined) return { update, error: "That Instagram handle doesn't look right — letters, numbers, dots and underscores, up to 30." };
    update.instagram_handle = ig;
  }
  if ("facebook" in body) {
    const fb = normalizeFacebook(body.facebook);
    if (fb === undefined) return { update, error: "That Facebook link doesn't look right — paste the page link or the page name." };
    update.facebook_url = fb;
  }
  if ("birthdayMonth" in body || "birthdayDay" in body) {
    const b = normalizeBirthday(body.birthdayMonth, body.birthdayDay);
    if (b === undefined) return { update, error: "Birthday needs both a month and a day (no year)." };
    update.birthday_month = b ? b.month : null;
    update.birthday_day = b ? b.day : null;
  }
  return { update, error: null };
}

/**
 * Days from `today` to the next occurrence of month/day (0 = today). Feb 29
 * counts as Feb 28 in non-leap years.
 */
export function daysUntilBirthday(month: number, day: number, today: Date): { days: number; date: Date } {
  const y = today.getFullYear();
  const start = new Date(y, today.getMonth(), today.getDate());
  const occurrence = (year: number) => {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const d = month === 2 && day === 29 && !leap ? 28 : day;
    return new Date(year, month - 1, d);
  };
  let next = occurrence(y);
  if (next < start) next = occurrence(y + 1);
  return { days: Math.round((next.getTime() - start.getTime()) / 86400000), date: next };
}
