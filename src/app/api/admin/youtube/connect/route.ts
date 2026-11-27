import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { googleClientSecret } from "@/lib/youtube/config";
import { buildYouTubeAuthUrl } from "@/lib/youtube/google";
import { YOUTUBE_STATE_COOKIE, YOUTUBE_STATE_TTL_MS, makeState, newNonce } from "@/lib/youtube/oauthState";
import { youtubeReadiness, youtubeRedirectUri, youtubeSiteOrigin } from "@/lib/youtube/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/youtube/connect — "Connect a channel" on Admin → YouTube.
 * Admin only. Sets a CSRF nonce cookie (httpOnly, SameSite=Lax) and sends the
 * browser to Google's consent screen asking for youtube.upload +
 * youtube.readonly, offline access, and the account / Brand Account picker.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const origin = youtubeSiteOrigin(req);
  const back = new URL("/admin/youtube", origin);

  const ready = await youtubeReadiness(auth.admin);
  if (!ready.configured) {
    back.searchParams.set("error", "not_set_up");
    return NextResponse.redirect(back);
  }
  if (!ready.ready) {
    back.searchParams.set("error", "migration");
    return NextResponse.redirect(back);
  }

  const nonce = newNonce();
  const redirectUri = youtubeRedirectUri(req);
  const state = makeState({ n: nonce, u: auth.userId, r: redirectUri, t: Date.now() }, googleClientSecret() as string);
  const res = NextResponse.redirect(buildYouTubeAuthUrl(redirectUri, state));
  res.cookies.set(YOUTUBE_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/admin/youtube",
    maxAge: Math.floor(YOUTUBE_STATE_TTL_MS / 1000),
  });
  return res;
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
