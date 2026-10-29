import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Open / click / sign-in tracking for campaign emails (Oct 29) — SERVER ONLY.
 *
 * Each tracked email has its email_log id chosen BEFORE sending
 * (newEmailLogId), and every link/pixel carries an opaque token for it:
 *   base64url(16 uuid bytes) "." base64url(first 12 bytes of HMAC-SHA256)
 * keyed off the service-role key (with a label), so ids can't be guessed or
 * forged. Events go to email_events (service role only).
 *   open   GET /api/e/o/{token}.gif — 1x1 GIF, at most one per email per hour
 *   click  GET /api/e/c/{token}?u=…  — only to portal.yachtpics.com / yachtpics.com
 *   signin when the recipient signs in within 7 days of a tracked email
 * Tracked rows are marked metadata.tracked = true (Slideshow-ready rows from
 * the first send, before tracking existed, count for sign-ins too).
 * Opens are approximate: some mail apps pre-load images (Apple Mail privacy),
 * others block them.
 */

const PORTAL = "https://portal.yachtpics.com";
const ALLOWED_HOSTS = new Set(["portal.yachtpics.com", "yachtpics.com", "www.yachtpics.com"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Email types that count for sign-in attribution even without metadata.tracked. */
export const LEGACY_TRACKED_TYPES = ["slideshow_ready_2026_10"];
export const SIGNIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function key(): Buffer {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createHmac("sha256", base).update("yp-email-tracking-v1").digest();
}

function b64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sig(idBytes: Buffer): Buffer {
  return createHmac("sha256", key()).update(idBytes).digest().subarray(0, 12);
}

export function newEmailLogId(): string {
  return randomUUID();
}

export function trackingToken(emailLogId: string): string {
  const idBytes = Buffer.from(emailLogId.replace(/-/g, ""), "hex");
  return `${b64url(idBytes)}.${b64url(sig(idBytes))}`;
}

/** The email_log id a token stands for, or null if it's malformed or forged. */
export function verifyTrackingToken(token: string): string | null {
  const m = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{16})$/.exec(token);
  if (!m) return null;
  const idBytes = fromB64url(m[1]);
  const given = fromB64url(m[2]);
  if (idBytes.length !== 16 || given.length !== 12) return null;
  if (!timingSafeEqual(given, sig(idBytes))) return null;
  const hex = idBytes.toString("hex");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID_RE.test(id) ? id : null;
}

/** Only our own sites — the click endpoint is never an open redirect. */
export function isAllowedRedirect(raw: string | null): raw is string {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

export function pixelUrl(emailLogId: string): string {
  return `${PORTAL}/api/e/o/${trackingToken(emailLogId)}.gif`;
}

export function clickUrl(emailLogId: string, url: string): string {
  return `${PORTAL}/api/e/c/${trackingToken(emailLogId)}?u=${encodeURIComponent(url)}`;
}

/**
 * Wrap every link to our sites (button and text links) through the click
 * endpoint and add the open pixel. Unsubscribe links are left alone, as are
 * mailto: and anything off our domains.
 */
export function trackEmailHtml(html: string, emailLogId: string): string {
  const decode = (s: string) => s.replace(/&amp;/g, "&");
  let out = html.replace(/href="([^"]+)"/g, (whole, href: string) => {
    const url = decode(href);
    if (/unsubscribe/i.test(url) || !isAllowedRedirect(url)) return whole;
    return `href="${clickUrl(emailLogId, url).replace(/&/g, "&amp;")}"`;
  });
  const pixel = `<img src="${pixelUrl(emailLogId)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;" />`;
  const i = out.lastIndexOf("</body>");
  out = i >= 0 ? `${out.slice(0, i)}${pixel}\n${out.slice(i)}` : out + pixel;
  return out;
}

/** Link scanners and preview bots — their hits aren't a person. Kept short on purpose. */
const BOT_UA = /bot\b|crawler|spider|slurp|preview|scanner|barracuda|proofpoint|mimecast|symantec|forcepoint|python-requests|curl\/|wget|headless/i;

export function isBotUa(ua: string | null): boolean {
  return !!ua && BOT_UA.test(ua);
}

export function ipHash(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(key()).update(ip).digest("hex").slice(0, 24);
}

export function requestIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}

/** Record an open or click. Best effort; never throws. */
export async function recordEmailEvent(
  svc: SupabaseClient,
  emailLogId: string,
  kind: "open" | "click",
  info: { url?: string | null; ua?: string | null; ip?: string | null }
): Promise<void> {
  try {
    const { data: log } = await svc.from("email_log").select("id, recipient_id").eq("id", emailLogId).maybeSingle();
    if (!log) return;
    if (kind === "open") {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recent } = await svc
        .from("email_events")
        .select("id")
        .eq("email_log_id", emailLogId)
        .eq("kind", "open")
        .gte("created_at", since)
        .limit(1);
      if (recent && recent.length > 0) return;
    }
    await svc.from("email_events").insert({
      email_log_id: emailLogId,
      broker_id: log.recipient_id ?? null,
      kind,
      url: info.url ?? null,
      ua: info.ua ? info.ua.slice(0, 400) : null,
      ip_hash: ipHash(info.ip ?? null),
    });
  } catch (e) {
    console.warn("recordEmailEvent failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * A sign-in: credit the recipient's most recent tracked email sent in the last
 * 7 days (one sign-in per email — a unique index makes repeats no-ops).
 */
export async function recordSigninAttribution(svc: SupabaseClient, userId: string, ua?: string | null): Promise<void> {
  try {
    if (!UUID_RE.test(userId)) return;
    const since = new Date(Date.now() - SIGNIN_WINDOW_MS).toISOString();
    const { data: logs } = await svc
      .from("email_log")
      .select("id")
      .eq("recipient_id", userId)
      .eq("status", "sent")
      .gte("sent_at", since)
      .or(`metadata->>tracked.eq.true,email_type.in.(${LEGACY_TRACKED_TYPES.join(",")})`)
      .order("sent_at", { ascending: false })
      .limit(1);
    const log = logs?.[0];
    if (!log) return;
    await svc.from("email_events").insert({ email_log_id: log.id, broker_id: userId, kind: "signin", ua: ua ? ua.slice(0, 400) : null });
  } catch {
    /* a duplicate sign-in for the same email hits the unique index — fine */
  }
}
