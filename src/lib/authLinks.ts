import { safeNextPath } from "@/lib/safeNext";

/**
 * Emailed one-time sign-in links (Nov 11, 2026) — safe for server and client.
 *
 * Corporate mail scanners (Microsoft Safe Links / Defender etc.) GET every URL
 * in an incoming email, often within seconds of delivery. A raw Supabase
 * verify link (…supabase.co/auth/v1/verify?token=…) is used up by that GET, so
 * the person's own click lands on "Link expired". So emailed links point at
 * /auth/continue instead, which verifies NOTHING on GET: it shows a "Continue"
 * button, and only the button's POST (/auth/continue/verify) spends the token.
 *
 * URLs carry Supabase's HASHED token (generateLink().properties.hashed_token,
 * or {{ .TokenHash }} in a Supabase email template) — never the raw OTP.
 */

export type EmailLinkType = "magiclink" | "invite" | "recovery" | "signup" | "email";

const TYPES: EmailLinkType[] = ["magiclink", "invite", "recovery", "signup", "email"];

export function parseLinkType(raw: unknown): EmailLinkType | null {
  return typeof raw === "string" && (TYPES as string[]).indexOf(raw) >= 0 ? (raw as EmailLinkType) : null;
}

/** Shape check only (Supabase's hashed token is hex); verification is Supabase's job. */
export function parseTokenHash(raw: unknown): string | null {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{16,256}$/.test(raw) ? raw : null;
}

/**
 * Display hint only — never trusted for anything but a comparison after verify.
 * Local part: letters, digits and the characters a normal address uses
 * (' + . _ - % and the other RFC 5322 atext symbols); never < > " ` \, spaces
 * or control characters. Domain: letters, digits, dot, hyphen.
 */
const EMAIL_HINT_RE = /^[a-z0-9!#$%&'*+\/=?^_{|}~.-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function parseEmailHint(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 3 || e.length > 254) return null;
  if (!EMAIL_HINT_RE.test(e)) return null;
  return e;
}

/**
 * Login-CSRF nonce for the Continue form (double-submit, Nov 11 review M1).
 * The middleware sets it in this cookie on GET /auth/continue (reusing a valid
 * one); the page renders the same value in a hidden field; the verify route
 * requires both, equal. HttpOnly; Secure; SameSite=Strict; Path=/auth/continue.
 */
export const CONTINUE_NONCE_COOKIE = "yp_continue";
export const CONTINUE_NONCE_FIELD = "nonce";
export const CONTINUE_NONCE_MAX_AGE = 3600;

/** 256 random bits, base64url. Web Crypto, so it runs in middleware (edge) and Node. */
export function newContinueNonce(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Shape check: base64url of at least 128 bits (22 chars), at most 128 chars. */
export function parseContinueNonce(raw: unknown): string | null {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{22,128}$/.test(raw) ? raw : null;
}

/** Both present, well-formed and equal; compared in constant time for equal lengths. */
export function continueNonceMatches(field: unknown, cookie: unknown): boolean {
  const a = parseContinueNonce(field);
  const b = parseContinueNonce(cookie);
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Where a link goes after a successful Continue. Invite and recovery links
 * must reach their password page (an invited user has no password yet), so
 * `next` is ignored for them; other types honour a validated same-site `next`.
 */
export function fixedDestination(type: EmailLinkType): string | null {
  if (type === "invite") return "/auth/set-password";
  if (type === "recovery") return "/auth/reset-password";
  return null;
}

export function continueQuery(opts: {
  tokenHash?: string | null;
  type?: EmailLinkType | null;
  email?: string | null;
  next?: string | null;
  notice?: string | null;
  expired?: boolean;
}): string {
  const q = new URLSearchParams();
  if (opts.tokenHash) q.set("token_hash", opts.tokenHash);
  if (opts.type) q.set("type", opts.type);
  const email = parseEmailHint(opts.email);
  if (email) q.set("email", email);
  const next = safeNextPath(opts.next);
  if (next) q.set("next", next);
  if (opts.notice) q.set("notice", opts.notice);
  if (opts.expired) q.set("expired", "1");
  return q.toString();
}

/** The URL to put in an email: the click-to-continue page on `origin`. */
export function continueUrl(origin: string, tokenHash: string, type: EmailLinkType, opts: { email?: string | null; next?: string | null } = {}): string {
  return `${origin.replace(/\/+$/, "")}/auth/continue?${continueQuery({ tokenHash, type, email: opts.email, next: opts.next })}`;
}
