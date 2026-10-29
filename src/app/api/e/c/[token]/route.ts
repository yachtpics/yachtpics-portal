import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/publicSlideshow";
import { isAllowedRedirect, isBotUa, recordEmailEvent, requestIp, verifyTrackingToken } from "@/lib/emailTracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK = "https://portal.yachtpics.com/dashboard";

/**
 * Click: /api/e/c/{token}?u=<url>. Redirects only to our own sites (an
 * off-site or malformed u goes to the dashboard instead), records the click
 * when the token is genuine, then 302s.
 */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const u = new URL(req.url).searchParams.get("u");
  const target = isAllowedRedirect(u) ? u : FALLBACK;
  const id = verifyTrackingToken(params.token);
  const ua = req.headers.get("user-agent");
  if (id && target !== FALLBACK && !isBotUa(ua)) {
    await recordEmailEvent(serviceClient(), id, "click", { url: target, ua, ip: requestIp(req.headers) });
  }
  return NextResponse.redirect(target, { status: 302, headers: { "Cache-Control": "no-store" } });
}
