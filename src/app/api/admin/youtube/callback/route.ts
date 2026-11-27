import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { YOUTUBE_SCOPES, googleClientSecret, youtubeConfigured } from "@/lib/youtube/config";
import { sealYouTubeToken } from "@/lib/youtube/crypto";
import { exchangeCode, myChannel } from "@/lib/youtube/google";
import { YOUTUBE_STATE_COOKIE, verifyState } from "@/lib/youtube/oauthState";
import { isMissingYouTubeSchema, youtubeSiteOrigin } from "@/lib/youtube/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/youtube/callback — Google sends the admin back here.
 * Checks the signed state against the nonce cookie and the signed-in admin,
 * swaps the code for tokens, asks YouTube which channel this sign-in is
 * (channels.list mine=true), and saves the channel keyed by its channel id
 * (connecting the same channel again updates it). Tokens are sealed
 * (src/lib/youtube/crypto.ts). Back to /admin/youtube?connected=1, or
 * ?error=<code> (src/lib/youtube/messages.ts).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const origin = youtubeSiteOrigin(req);
  const back = new URL("/admin/youtube", origin);
  const done = (code: string | null) => {
    if (code) back.searchParams.set("error", code);
    else back.searchParams.set("connected", "1");
    const res = NextResponse.redirect(back);
    res.cookies.set(YOUTUBE_STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/api/admin/youtube", maxAge: 0 });
    return res;
  };

  if (!youtubeConfigured()) return done("not_set_up");
  const q = req.nextUrl.searchParams;
  const check = verifyState(q.get("state"), req.cookies.get(YOUTUBE_STATE_COOKIE)?.value, auth.userId, googleClientSecret() as string);
  if (!check.ok) return done("state");
  if (q.get("error")) return done("denied");
  const code = q.get("code");
  if (!code) return done("denied");

  // The same redirect URI as the consent request (it travelled in the signed state).
  const tokens = await exchangeCode(code, check.payload.r);
  const t = tokens.json;
  if (tokens.status !== 200 || !t?.access_token) return done("exchange");
  const granted = (t.scope ?? "").split(/\s+/);
  if (t.scope && granted.indexOf(YOUTUBE_SCOPES[0]) < 0) return done("scope");

  const ch = await myChannel(t.access_token);
  if (!ch.channel) return done(ch.status === 200 ? "no_channel" : "channel_read");

  const svc = auth.admin;
  const { data: existing, error: readErr } = await svc
    .from("youtube_channels")
    .select("id, needs_reconnect")
    .eq("channel_id", ch.channel.id)
    .maybeSingle();
  if (readErr) return done(isMissingYouTubeSchema(readErr) ? "migration" : "save");

  // Without a refresh token the Portal can't upload with the browser closed.
  // Keep an existing good one; otherwise say so plainly.
  if (!t.refresh_token && (!existing || existing.needs_reconnect)) return done("no_refresh");

  const now = new Date().toISOString();
  const fields: Record<string, unknown> = {
    channel_id: ch.channel.id,
    title: ch.channel.title,
    handle: ch.channel.handle,
    thumbnail_url: ch.channel.thumbnail,
    access_token_enc: sealYouTubeToken(t.access_token),
    access_token_expires_at: new Date(Date.now() + Math.max(60, Number(t.expires_in) || 3600) * 1000).toISOString(),
    needs_reconnect: false,
    updated_at: now,
  };
  if (t.refresh_token) fields.refresh_token_enc = sealYouTubeToken(t.refresh_token);

  const write = existing
    ? svc.from("youtube_channels").update({ ...fields, connected_by: auth.userId }).eq("id", existing.id)
    : svc.from("youtube_channels").insert({ ...fields, connected_by: auth.userId });
  const { error } = await write;
  if (error) return done(isMissingYouTubeSchema(error) ? "migration" : "save");
  return done(null);
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
