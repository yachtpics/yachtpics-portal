/**
 * Signed OAuth `state` for Connect a YouTube channel (Nov 27, 2026).
 *
 * The state Google hands back is "<payload>.<sig>": payload = base64url JSON
 * { n: nonce, u: admin's user id, r: redirect URI used, t: issued (ms) },
 * sig = HMAC-SHA256(payload) under a key derived from the OAuth client
 * secret. The nonce is ALSO put in an httpOnly, SameSite=Lax cookie; the
 * callback accepts only when the signature checks out, the state is under 10
 * minutes old, the cookie's nonce matches and the signed-in admin is the one
 * who started. Pure (node crypto only) — checked by
 * scripts/youtube_upload_check.ts.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export const YOUTUBE_STATE_COOKIE = "yp_yt_state";
export const YOUTUBE_STATE_TTL_MS = 10 * 60_000;

export type YouTubeStatePayload = { n: string; u: string; r: string; t: number };

function stateKey(secret: string): Buffer {
  return createHash("sha256").update(`yachtpics-youtube-oauth-state-v1:${secret}`).digest();
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", stateKey(secret)).update(payload).digest("base64url");
}

export function newNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function makeState(p: YouTubeStatePayload, secret: string): string {
  const payload = Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

function sameString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export type StateCheck = { ok: true; payload: YouTubeStatePayload } | { ok: false; why: string };

/**
 * Check the state Google returned against the cookie's nonce and the
 * signed-in admin. `now` is passed in so the check is testable.
 */
export function verifyState(
  state: string | null | undefined,
  cookieNonce: string | null | undefined,
  userId: string,
  secret: string,
  now: number = Date.now()
): StateCheck {
  if (!state || state.indexOf(".") < 0) return { ok: false, why: "missing" };
  const [payload, sig] = state.split(".", 2);
  if (!payload || !sig || !sameString(sig, sign(payload, secret))) return { ok: false, why: "signature" };
  let p: YouTubeStatePayload;
  try {
    p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as YouTubeStatePayload;
  } catch {
    return { ok: false, why: "payload" };
  }
  if (!p || typeof p.n !== "string" || typeof p.u !== "string" || typeof p.r !== "string" || typeof p.t !== "number") {
    return { ok: false, why: "payload" };
  }
  if (now - p.t > YOUTUBE_STATE_TTL_MS || p.t - now > 60_000) return { ok: false, why: "expired" };
  if (!cookieNonce || !sameString(cookieNonce, p.n)) return { ok: false, why: "cookie" };
  if (p.u !== userId) return { ok: false, why: "user" };
  return { ok: true, payload: p };
}
