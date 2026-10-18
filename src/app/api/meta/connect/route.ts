import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { metaConfigured } from "@/lib/meta/config";
import { STATE_COOKIE, buildAuthUrl, requestOrigin } from "@/lib/meta/oauth";
import { socialViewer } from "@/lib/meta/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/meta/connect — start "Connect Facebook & Instagram".
 * Sets a CSRF state cookie and sends the browser to Facebook's login dialog.
 */
export async function GET(req: NextRequest) {
  const origin = requestOrigin(req);
  const viewer = await socialViewer();
  if (!viewer) return NextResponse.redirect(new URL("/auth/login", origin));
  const back = new URL("/dashboard/profile", origin);
  if (!viewer.allowed) {
    back.searchParams.set("social", "error");
    back.searchParams.set("reason", "Social publishing isn't available on your account yet.");
    return NextResponse.redirect(back);
  }
  if (!metaConfigured()) {
    back.searchParams.set("social", "error");
    back.searchParams.set("reason", "Facebook isn't configured on the portal yet.");
    return NextResponse.redirect(back);
  }

  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(buildAuthUrl(origin, state));
  res.cookies.set(STATE_COOKIE, `${state}.${viewer.userId}`, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/meta",
    maxAge: 10 * 60,
  });
  return res;
}
