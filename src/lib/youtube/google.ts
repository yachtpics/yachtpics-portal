/**
 * The Google / YouTube HTTP calls (Nov 27, 2026). Server only.
 * Every fetch passes cache: "no-store" (CLAUDE.md) and has a timeout.
 */
import {
  GOOGLE_AUTH_URL, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, YOUTUBE_API, YOUTUBE_REQUEST_TIMEOUT_MS, YOUTUBE_SCOPES,
  googleClientId, googleClientSecret,
} from "./config";

export type GoogleAnswer<T = unknown> = { status: number; json: T | null; headers: Headers | null; error?: string };

/** fetch that never throws: status 0 = no answer (network / timeout). */
export async function googleFetch<T = unknown>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<GoogleAnswer<T>> {
  const { timeoutMs, ...rest } = init;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs ?? YOUTUBE_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...rest, cache: "no-store", signal: ctl.signal });
    const text = await res.text().catch(() => "");
    let json: T | null = null;
    if (text) {
      try {
        json = JSON.parse(text) as T;
      } catch {
        json = null;
      }
    }
    return { status: res.status, json, headers: res.headers };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "timed out" : e.message) : String(e);
    return { status: 0, json: null, headers: null, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export function buildYouTubeAuthUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: googleClientId() ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${q}`;
}

export type GoogleTokens = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

function form(body: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  };
}

export async function exchangeCode(code: string, redirectUri: string): Promise<GoogleAnswer<GoogleTokens>> {
  return googleFetch<GoogleTokens>(
    GOOGLE_TOKEN_URL,
    form({
      code,
      client_id: googleClientId() ?? "",
      client_secret: googleClientSecret() ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    })
  );
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleAnswer<GoogleTokens>> {
  return googleFetch<GoogleTokens>(
    GOOGLE_TOKEN_URL,
    form({
      refresh_token: refreshToken,
      client_id: googleClientId() ?? "",
      client_secret: googleClientSecret() ?? "",
      grant_type: "refresh_token",
    })
  );
}

/** Best effort: Google forgets this permission. */
export async function revokeToken(token: string): Promise<boolean> {
  const r = await googleFetch(GOOGLE_REVOKE_URL, { ...form({ token }), timeoutMs: 10_000 });
  return r.status === 200;
}

export type YouTubeChannelInfo = { id: string; title: string | null; handle: string | null; thumbnail: string | null };

/** The channel this sign-in belongs to (one sign-in = one channel). */
export async function myChannel(accessToken: string): Promise<{ channel: YouTubeChannelInfo | null; status: number; json: unknown }> {
  const r = await googleFetch<{
    items?: { id: string; snippet?: { title?: string; customUrl?: string; thumbnails?: Record<string, { url?: string }> } }[];
  }>(`${YOUTUBE_API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const item = r.status === 200 ? r.json?.items?.[0] : undefined;
  if (!item) return { channel: null, status: r.status, json: r.json };
  const th = item.snippet?.thumbnails ?? {};
  return {
    channel: {
      id: item.id,
      title: item.snippet?.title ?? null,
      handle: item.snippet?.customUrl ?? null,
      thumbnail: th.medium?.url ?? th.default?.url ?? th.high?.url ?? null,
    },
    status: r.status,
    json: r.json,
  };
}

export type YouTubeVideoState = {
  uploadStatus: string | null;
  failureReason: string | null;
  rejectionReason: string | null;
  processingStatus: string | null;
};

/** videos.list for one id: where YouTube's processing has got to. */
export async function videoState(accessToken: string, videoId: string): Promise<GoogleAnswer<{ items?: unknown[] }> & { state: YouTubeVideoState | null }> {
  const r = await googleFetch<{
    items?: { status?: { uploadStatus?: string; failureReason?: string; rejectionReason?: string }; processingDetails?: { processingStatus?: string } }[];
  }>(`${YOUTUBE_API}/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const it = r.status === 200 ? r.json?.items?.[0] : undefined;
  return {
    ...r,
    state: it
      ? {
          uploadStatus: it.status?.uploadStatus ?? null,
          failureReason: it.status?.failureReason ?? null,
          rejectionReason: it.status?.rejectionReason ?? null,
          processingStatus: it.processingDetails?.processingStatus ?? null,
        }
      : null,
  };
}
