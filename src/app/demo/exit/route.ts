import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { DEMO_REQUEST_ACCESS_PATH, isDemoUser } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /demo/exit — the demo banner's "Request access →" (Nov 10, 2026).
 *
 * /auth/signup bounces a signed-in visitor to /dashboard, and signing up
 * while the demo session is still in the browser would mix the two. So:
 * if THIS browser's session is the demo, sign it out here (this browser
 * only — the capture browser's other sessions are untouched), then go to
 * the signup page /see links to. Anyone else is just sent on; a real
 * session is never signed out by this route.
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL(DEMO_REQUEST_ACCESS_PATH, req.url), 303);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return res;
  try {
    const pending: { name: string; value: string; options: CookieOptions }[] = [];
    const ssr = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach((c) => pending.push(c));
        },
      },
    });
    const { data } = await ssr.auth.getUser();
    if (data?.user && isDemoUser(data.user)) {
      await ssr.auth.signOut({ scope: "local" });
      pending.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
    }
  } catch {
    /* just go on to the signup page */
  }
  return res;
}
