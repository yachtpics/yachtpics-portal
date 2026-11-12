import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isDemoUser } from "@/lib/demo";
import { rateLimited } from "@/lib/simpleRateLimit";
import { safeNextPath } from "@/lib/safeNext";
import { serviceClient } from "@/lib/publicSlideshow";
import { recordSigninAttribution } from "@/lib/emailTracking";
import {
  CONTINUE_NONCE_COOKIE,
  CONTINUE_NONCE_FIELD,
  continueNonceMatches,
  continueQuery,
  fixedDestination,
  parseEmailHint,
  parseLinkType,
  parseTokenHash,
} from "@/lib/authLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /auth/continue/verify — the Continue button on /auth/continue (Nov 11, 2026).
 *
 * The ONLY place an emailed one-time link's token is spent: a form POST, so a
 * mail scanner's GET (or a link preview) never reaches it. There is no GET
 * handler (405).
 *
 * Steps: login-CSRF checks (Sec-Fetch-Site / Origin, then the yp_continue
 * nonce cookie must equal the form's hidden nonce — the middleware set both on
 * the GET; mismatch → back to the page, "Please press Continue again", nothing
 * spent) → rate limit per IP → read the form (token_hash, type, optional email
 * hint and next) → who is signed in here already? (someone else: never swap,
 * send back to the page, which says "You're signed in as X — sign out to
 * continue as Y"; the same person: just go on, token NOT spent) →
 * verifyOtp({ token_hash, type }) on a cookie-writing SSR client → refuse
 * (revoke the new session with the admin API, send no cookies) if it's the
 * read-only demo account or not the email the page showed → 303 to the
 * destination with the session cookies (nonce cookie cleared). A failed verify
 * (used / expired / malformed) → /auth/continue?expired=1, the "Email me a
 * new link" page; Supabase rate-limiting (429) → back with notice=wait, token
 * kept. Every redirect after the SSR client exists carries its refreshed
 * cookies (`pending`), except the refusal.
 *
 * intent=signout: signs THIS browser's session out (scope local) and returns
 * to the Continue page with the same link.
 *
 * Never logs the token or the URL. Not under /api, so the middleware's demo
 * read-only gate doesn't see it (the middleware matcher includes the exact
 * page path /auth/continue, never /verify); the demo account is refused here
 * instead.
 */

const HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

type Pending = { name: string; value: string; options: CookieOptions };

function go(req: NextRequest, path: string, cookies: Pending[] = []): NextResponse {
  const res = NextResponse.redirect(new URL(path, req.url), 303);
  Object.keys(HEADERS).forEach((k) => res.headers.set(k, HEADERS[k]));
  cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
  return res;
}

function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

function field(form: FormData | null, name: string): string | null {
  const v = form ? form.get(name) : null;
  return typeof v === "string" ? v : null;
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const tokenHash = parseTokenHash(field(form, "token_hash"));
  const type = parseLinkType(field(form, "type"));
  const email = parseEmailHint(field(form, "email"));
  const next = safeNextPath(field(form, "next"));
  const intent = field(form, "intent");

  // Cookies the SSR client wants written (a refreshed or new session). Filled
  // only once the client exists; every redirect below carries them.
  const pending: Pending[] = [];
  const expired = () => go(req, `/auth/continue?${continueQuery({ email, next, expired: true })}`, pending);
  const back = (notice?: string) =>
    tokenHash && type ? go(req, `/auth/continue?${continueQuery({ tokenHash, type, email, next, notice })}`, pending) : expired();

  try {
    // Login-CSRF guard: the Continue form is on our own page, so a POST from
    // another site (which could sign a visitor into an account they didn't
    // ask for) is refused before anything is spent. Note the page's
    // Referrer-Policy no-referrer makes browsers send `Origin: null` on its
    // own form POST, so "null" is not treated as foreign; Sec-Fetch-Site
    // (sent by current Chrome / Edge / Firefox / Safari) is the main check.
    // Review M1: Sec-Fetch-Site, when sent, must be same-origin (an absent
    // header — old Safari — is covered by the nonce below). Origin is an
    // extra signal only.
    const origin = req.headers.get("origin");
    const site = req.headers.get("sec-fetch-site");
    if ((origin && origin !== "null" && origin !== new URL(req.url).origin) || (site !== null && site.toLowerCase() !== "same-origin")) {
      return go(req, "/auth/login");
    }

    // Double-submit nonce: the hidden field must equal the yp_continue cookie
    // the middleware set when this page was shown. A forged cross-site form
    // can't read or set that cookie. Never verify on a mismatch.
    if (!continueNonceMatches(field(form, CONTINUE_NONCE_FIELD), req.cookies.get(CONTINUE_NONCE_COOKIE)?.value)) {
      return back("again");
    }

    // Per server instance; stops a script hammering verify, never a person.
    if (rateLimited(`auth-continue:${clientIp(req)}`, 20, 10 * 60_000)) return back("busy");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return expired();

    const ssr = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet: Pending[]) {
          cookiesToSet.forEach((c) => pending.push(c));
        },
      },
    });

    const { data: current } = await ssr.auth.getUser();
    const currentUser = current?.user ?? null;

    if (intent === "signout") {
      if (currentUser) await ssr.auth.signOut({ scope: "local" });
      return back();
    }

    if (!tokenHash || !type) return expired();

    if (currentUser) {
      const same = !!email && (currentUser.email ?? "").toLowerCase() === email && !isDemoUser(currentUser);
      // Same person, already signed in: go on without spending the token.
      if (same) return go(req, fixedDestination(type) ?? next ?? "/dashboard", pending);
      // Someone else: the page explains and offers "Sign out".
      return back();
    }

    const { data, error } = await ssr.auth.verifyOtp({ token_hash: tokenHash, type });
    const user = data?.user ?? null;
    if (error || !user || !data?.session) {
      const code = (error as { code?: string } | null)?.code ?? (error ? String(error.status ?? "") : "no-session");
      console.warn(`[auth-continue] verify failed type=${type} code=${code}`);
      // Review M3: Supabase rate-limiting is "try again shortly", not "expired" —
      // the token wasn't spent, so keep it.
      if (error && (error.status === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit")) {
        return back("wait");
      }
      return expired();
    }

    // The read-only demo is entered only through /demo/{token}; and a link
    // whose page showed one email must not sign in a different account.
    const wrongEmail = !!email && (user.email ?? "").toLowerCase() !== email;
    if (isDemoUser(user) || wrongEmail) {
      console.warn(`[auth-continue] refused type=${type} reason=${isDemoUser(user) ? "demo" : "email-mismatch"}`);
      // Review L6: revoke the session verifyOtp just created (the cookie-based
      // signOut() doesn't know about it — its cookies were never sent), and
      // send the browser no cookies at all.
      pending.length = 0;
      try {
        await serviceClient().auth.admin.signOut(data.session.access_token, "local");
      } catch {
        /* best effort */
      }
      return go(req, `/auth/continue?${continueQuery({ expired: true })}`);
    }

    let destination = fixedDestination(type) ?? next;
    if (!destination) {
      destination = "/dashboard/listings";
      try {
        const { data: profile } = await serviceClient().from("profiles").select("role").eq("id", user.id).single();
        if (profile?.role === "admin") destination = "/admin";
        else if (profile?.role === "client") destination = "/client";
      } catch {
        /* default */
      }
    }

    // Credit a recent campaign email with this sign-in (never blocks it).
    try {
      await recordSigninAttribution(serviceClient(), user.id, req.headers.get("user-agent"));
    } catch {
      /* ignore */
    }

    const res = go(req, destination, pending);
    // Signed in: the nonce has done its job.
    res.cookies.set(CONTINUE_NONCE_COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/auth/continue",
      maxAge: 0,
    });
    return res;
  } catch {
    // Never echo the error (or the token).
    return expired();
  }
}
