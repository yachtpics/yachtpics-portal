import { NextRequest, NextResponse } from "next/server";
import { metaConfigured } from "@/lib/meta/config";
import { sealJson } from "@/lib/meta/crypto";
import { graphErrorMessage } from "@/lib/meta/graph";
import {
  PENDING_COOKIE, PENDING_TTL_SEC, STATE_COOKIE, exchangeCode, fbMe, longLivedUserToken, requestOrigin,
  type PendingConnect,
} from "@/lib/meta/oauth";
import { socialViewer } from "@/lib/meta/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/meta/callback — Facebook sends the user back here.
 *
 * Checks the state cookie, swaps the code for a long-lived user token, and
 * keeps that token (encrypted, httpOnly, 15 minutes) while the user picks
 * which Page to connect on Profile → Social accounts. No Page token is saved
 * until they choose.
 */
export async function GET(req: NextRequest) {
  const origin = requestOrigin(req);
  const back = new URL("/dashboard/profile", origin);
  back.hash = "social-accounts";
  const fail = (reason: string) => {
    back.searchParams.set("social", "error");
    back.searchParams.set("reason", reason.slice(0, 200));
    const res = NextResponse.redirect(back);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/meta", maxAge: 0 });
    return res;
  };

  const viewer = await socialViewer();
  if (!viewer) return NextResponse.redirect(new URL("/auth/login", origin));
  if (!viewer.allowed || !metaConfigured()) return fail("Social publishing isn't available.");

  const q = req.nextUrl.searchParams;
  if (q.get("error")) return fail(q.get("error_description") || "Facebook sign-in was cancelled.");

  const cookie = req.cookies.get(STATE_COOKIE)?.value ?? "";
  const [state, uid] = cookie.split(".");
  if (!state || !q.get("state") || state !== q.get("state") || uid !== viewer.userId) {
    return fail("That sign-in link expired. Please try Connect again.");
  }
  const code = q.get("code");
  if (!code) return fail("Facebook didn't send a sign-in code.");

  try {
    const short = await exchangeCode(code, origin);
    const long = await longLivedUserToken(short);
    const me = await fbMe(long.token);
    const pending: PendingConnect = {
      uid: viewer.userId,
      fbUserId: me.id,
      userToken: long.token,
      userTokenExpiresAt: long.expiresAt,
      exp: Date.now() + PENDING_TTL_SEC * 1000,
    };
    back.searchParams.set("social", "choose");
    const res = NextResponse.redirect(back);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/meta", maxAge: 0 });
    res.cookies.set(PENDING_COOKIE, sealJson(pending), {
      httpOnly: true,
      secure: origin.startsWith("https://"),
      sameSite: "lax",
      path: "/api/social",
      maxAge: PENDING_TTL_SEC,
    });
    return res;
  } catch (e) {
    return fail(`Couldn't finish connecting: ${graphErrorMessage(e)}`);
  }
}
