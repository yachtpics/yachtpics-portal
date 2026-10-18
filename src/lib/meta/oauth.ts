import { createHmac, timingSafeEqual } from "crypto";
import { FB_DIALOG, META_SCOPES, metaAppId, metaAppSecret, metaLoginConfigId } from "./config";
import { graphDelete, graphGet } from "./graph";

/** Cookie names. */
export const STATE_COOKIE = "yp_meta_state";
/** Sealed { uid, fbUserId, userToken, exp } while the user picks a Page. */
export const PENDING_COOKIE = "yp_meta_pending";
/** How long the "pick a Page" step stays open. */
export const PENDING_TTL_SEC = 15 * 60;

export type PendingConnect = { uid: string; fbUserId: string; userToken: string; userTokenExpiresAt: number | null; exp: number };

/** The callback URL for this deployment — derived from the request so localhost and previews work. */
export function redirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/meta/callback`;
}

/**
 * The request's public origin. Vercel sets x-forwarded-host/proto; fall back
 * to the URL Next.js saw.
 */
export function requestOrigin(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || (host && host.startsWith("localhost") ? "http" : "https");
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export function buildAuthUrl(origin: string, state: string): string {
  const q = new URLSearchParams({
    client_id: metaAppId() ?? "",
    redirect_uri: redirectUri(origin),
    state,
    response_type: "code",
  });
  const configId = metaLoginConfigId();
  if (configId) q.set("config_id", configId);
  else q.set("scope", META_SCOPES.join(","));
  return `${FB_DIALOG}?${q}`;
}

/** code → short-lived user token. */
export async function exchangeCode(code: string, origin: string): Promise<string> {
  const r = await graphGet<{ access_token: string }>("oauth/access_token", {
    client_id: metaAppId(),
    client_secret: metaAppSecret(),
    redirect_uri: redirectUri(origin),
    code,
  });
  return r.access_token;
}

/** short-lived → long-lived (~60 day) user token. Page tokens fetched with it don't expire. */
export async function longLivedUserToken(shortToken: string): Promise<{ token: string; expiresAt: number | null }> {
  const r = await graphGet<{ access_token: string; expires_in?: number }>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: metaAppId(),
    client_secret: metaAppSecret(),
    fb_exchange_token: shortToken,
  });
  return { token: r.access_token, expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : null };
}

export async function fbMe(userToken: string): Promise<{ id: string; name?: string }> {
  return graphGet<{ id: string; name?: string }>("me", { fields: "id,name" }, userToken);
}

export type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string } | null;
};

/** The Pages this user manages, each with its Page token and linked IG account. */
export async function listPages(userToken: string): Promise<MetaPage[]> {
  const out: MetaPage[] = [];
  let after: string | undefined;
  for (let i = 0; i < 5; i++) {
    const r = await graphGet<{ data: MetaPage[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      "me/accounts",
      { fields: "id,name,access_token,instagram_business_account{id,username}", limit: 100, after },
      userToken
    );
    out.push(...(r.data ?? []));
    if (!r.paging?.next || !r.paging.cursors?.after) break;
    after = r.paging.cursors.after;
  }
  return out;
}

/** App access token ("{app-id}|{app-secret}") — for app-level calls like revoking. */
export function appAccessToken(): string | null {
  const id = metaAppId();
  const secret = metaAppSecret();
  return id && secret ? `${id}|${secret}` : null;
}

/** Best effort: remove the app's permissions for this Facebook user. */
export async function revokePermissions(fbUserId: string): Promise<boolean> {
  const t = appAccessToken();
  if (!t) return false;
  try {
    await graphDelete(`${encodeURIComponent(fbUserId)}/permissions`, {}, t);
    return true;
  } catch {
    return false;
  }
}

/**
 * Meta's signed_request (Data Deletion Callback, Deauthorize):
 * "<sig>.<payload>", base64url, sig = HMAC-SHA256(payload, app secret).
 * Returns the payload, or null if the signature doesn't check out.
 */
export function parseSignedRequest(signed: string): { user_id?: string; algorithm?: string; issued_at?: number } | null {
  const secret = metaAppSecret();
  if (!secret || !signed || signed.indexOf(".") < 0) return null;
  const [encSig, payload] = signed.split(".", 2);
  try {
    const sig = Buffer.from(encSig, "base64url");
    const expected = createHmac("sha256", secret).update(payload).digest();
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data?.algorithm && String(data.algorithm).toUpperCase() !== "HMAC-SHA256") return null;
    return data;
  } catch {
    return null;
  }
}
