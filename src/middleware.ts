import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { safeNextPath } from '@/lib/safeNext'
import { accessTokenHasDemoClaim, demoPostAllowed, DEMO_BLOCK_HEADER, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { CONTINUE_NONCE_COOKIE, CONTINUE_NONCE_MAX_AGE, newContinueNonce, parseContinueNonce } from '@/lib/authLinks'

/**
 * Send a signed-out visitor to the login page, remembering where they were
 * headed (path + query only — never a full URL) so an emailed link still
 * lands on the right page after they sign in.
 */
function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL('/auth/login', request.url)
  const next = safeNextPath(request.nextUrl.pathname + request.nextUrl.search)
  if (next && next !== '/dashboard') loginUrl.searchParams.set('next', next)
  return NextResponse.redirect(loginUrl)
}

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];
/** Supabase SSR auth cookies (chunked: sb-<ref>-auth-token.0, .1 …). */
const AUTH_COOKIE_RE = /^sb-.+-auth-token(\.\d+)?$/;
/** Demo gate: refresh in the middleware when the session ends within this (seconds). */
const REFRESH_MARGIN_S = 10 * 60;

function demoBlocked(): NextResponse {
  return NextResponse.json(
    { error: DEMO_READ_ONLY_MESSAGE, demo: true },
    { status: 403, headers: { [DEMO_BLOCK_HEADER]: "1", "Cache-Control": "no-store" } }
  );
}

/**
 * Read-only DEMO, layer 1 (Nov 10, 2026 — see src/lib/demo.ts).
 *
 * A request that would change something (any method but GET/HEAD/OPTIONS) to
 * /api/* (here), or to a matched page path (a Next server action is a POST to
 * the page — the app has none today; checked in middleware() below), is refused with 403
 * when the session carries the demo claim, unless the /api path is on
 * DEMO_POST_ALLOWLIST (endpoints that only sign URLs or read).
 *
 * The session is read with the SAME @supabase/ssr client the route will use
 * (getSession(): cookie parsing, chunked cookies, base64- values, and the
 * refresh of an expired access token all identical), so the token decoded
 * here is the token the route runs with. getSession() is local — no network
 * round trip — unless the token has expired, exactly as in the route.
 *
 * The claim is read from the token payload WITHOUT verifying the signature.
 * That is sound for BLOCKING: a forged cookie that hides the claim also fails
 * getUser() in the route (Supabase Auth verifies the signature), so it gets
 * nowhere.
 *
 * The refresh race (review H1b): a forged access token (no claim) whose
 * expires_at is close, paired with a real demo refresh token, used to pass
 * here — and the route, refreshing on its own mid-request, would then run
 * with a REAL demo token. So: if the session expires within REFRESH_MARGIN_S
 * (or expires_at is missing / invalid), refresh it HERE, forward the fresh
 * cookies, and read the claim from the refreshed token; the route then can't
 * reach its own refresh within any route's run time. If that refresh fails,
 * the request goes on with the sb-* auth cookies REMOVED, i.e. signed out.
 * A forged token claiming a far expiry is never refreshed by the route
 * (getUser() just rejects it).
 *
 * Deliberately NO getUser() round trip here (it would slow every save for
 * every user). That is acceptable only because layer 3 is complete: every
 * service-role write route for a signed-in broker calls demoGuard itself
 * (docs/where-we-are.md has the table), and layer 2 (RLS) covers direct
 * Supabase writes. This gate is the fast, friendly refusal, not the wall.
 *
 * Returns a response to send, or null to carry on.
 */
async function demoReadOnlyGate(
  request: NextRequest,
  supabaseUrl: string,
  supabaseKey: string
): Promise<{ block: NextResponse | null; refreshed: NextResponse | null }> {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.indexOf(method) >= 0) return { block: null, refreshed: null };
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/") && demoPostAllowed(path)) return { block: null, refreshed: null };

  // A bearer token (no route reads one for a user today; cheap to cover).
  const auth = request.headers.get("authorization") ?? "";
  if (/^bearer\s+/i.test(auth) && accessTokenHasDemoClaim(auth.replace(/^bearer\s+/i, "").trim())) {
    return { block: demoBlocked(), refreshed: null };
  }

  // No Supabase auth cookie at all → nothing to decode (public routes, crons, webhooks).
  const hasAuthCookie = request.cookies.getAll().some((c) => AUTH_COOKIE_RE.test(c.name));
  if (!hasAuthCookie) return { block: null, refreshed: null };

  let response = NextResponse.next({ request });
  let wrote = false;
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        wrote = true;
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { session: stored } } = await supabase.auth.getSession();
  let session = stored;
  if (session) {
    const exp = typeof session.expires_at === "number" ? session.expires_at : NaN;
    if (!Number.isFinite(exp) || exp - Math.floor(Date.now() / 1000) < REFRESH_MARGIN_S) {
      // A throw counts as a failed refresh (the outer catch fails OPEN, which
      // would hand the route the un-refreshed cookies).
      const r = await supabase.auth.refreshSession().catch(() => null);
      if (!r || r.error || !r.data?.session) {
        // Forward as signed out: strip every Supabase auth cookie from the
        // request the route sees. (The browser's cookies are left alone.)
        request.cookies.getAll().forEach((c) => {
          if (AUTH_COOKIE_RE.test(c.name)) request.cookies.delete(c.name);
        });
        return { block: null, refreshed: NextResponse.next({ request }) };
      }
      session = r.data.session;
    }
  }
  if (session && accessTokenHasDemoClaim(session.access_token)) {
    const block = demoBlocked();
    // Keep a refreshed session (rotated refresh token) even on a refusal.
    if (wrote) response.cookies.getAll().forEach((c) => block.cookies.set(c));
    return { block, refreshed: null };
  }
  // If getSession refreshed the token, pass the new cookies on so the route
  // doesn't refresh (and rotate the refresh token) a second time.
  return { block: null, refreshed: wrote ? response : null };
}

/**
 * /auth/continue (the page an emailed sign-in link opens; Nov 11 review M1 + L1).
 *
 * 1. Login-CSRF nonce: on GET, if the browser didn't send a valid yp_continue
 *    cookie, mint one and write it BOTH onto the forwarded request (so the
 *    page's cookies() already sees it on this first render and puts it in the
 *    hidden field) AND onto the response as Set-Cookie (so the browser sends
 *    it with the Continue POST). A valid existing cookie is reused, so two
 *    tabs / the back button keep working. A mail scanner's GET just gets its
 *    own nonce.
 * 2. Session refresh: getSession() refreshes an expired access token and the
 *    new cookies are persisted here (a Server Component can't write cookies).
 *    No redirects of any kind: signed-out visitors stay, signed-in visitors
 *    are not bounced (the page itself explains "already signed in"), and the
 *    demo read-only gate is not applied (the page has no server actions; GET
 *    is all it serves). Nothing here verifies the link.
 * /auth/continue/verify is deliberately NOT in the matcher.
 */
async function continuePage(request: NextRequest): Promise<NextResponse> {
  let nonce: string | null = null
  if (request.method.toUpperCase() === 'GET' && !parseContinueNonce(request.cookies.get(CONTINUE_NONCE_COOKIE)?.value)) {
    nonce = newContinueNonce()
    request.cookies.set(CONTINUE_NONCE_COOKIE, nonce)
  }
  let response = NextResponse.next({ request })
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (supabaseUrl && supabaseKey) {
      const supabase = createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            response = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
          },
        },
      })
      await supabase.auth.getSession()
    }
  } catch (error) {
    console.error('Middleware error (continue):', error)
    response = NextResponse.next({ request })
  }
  if (nonce) {
    response.cookies.set(CONTINUE_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/auth/continue',
      maxAge: CONTINUE_NONCE_MAX_AGE,
    })
  }
  return response
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/auth/continue') return continuePage(request)
  try {
    // /api is matched ONLY for the demo read-only gate; nothing else here
    // applies to it.
    if (request.nextUrl.pathname.startsWith("/api/")) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return NextResponse.next({ request });
      const gate = await demoReadOnlyGate(request, url, key);
      return gate.block ?? gate.refreshed ?? NextResponse.next({ request });
    }

    let supabaseResponse = NextResponse.next({ request })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    // If env vars are missing, let the request through — pages will handle auth
    if (!supabaseUrl || !supabaseKey) {
      return supabaseResponse
    }

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    })

    // ── This middleware is a redirect convenience, NOT the security boundary ──
    //
    // It only decides whether to bounce a signed-out visitor to the login page
    // (and a signed-in one away from it). What actually protects data is:
    //   - every admin page calls requireAdminPage() (getUser + role check),
    //   - every /api/admin route calls requireAdmin() or its own getUser + role,
    //   - dashboard/client pages call getUser() or read through RLS, which
    //     verifies the token on the database side for every query.
    //
    // So here we use getSession(), which reads the session from the cookie
    // locally, instead of getUser(), which is a round trip to Supabase Auth.
    // That round trip ran before EVERY /dashboard, /admin and /client request —
    // prefetches included — and delayed even the loading skeleton.
    //
    // Cookie refresh is unchanged: getSession() still refreshes an expired
    // access token with the refresh token and writes the new cookies through
    // setAll() above, exactly as getUser() did (it goes through the same
    // session-loading step first). Only `!!session` is read — touching
    // session.user on the server would log Supabase's "insecure" warning.
    const path = request.nextUrl.pathname
    const isAuthPage = path.startsWith('/auth/login') || path.startsWith('/auth/signup')

    let user: unknown = null
    if (isAuthPage) {
      // The "already signed in, go to the dashboard" bounce keeps the verified
      // check. A revoked-but-unexpired token would otherwise pass here, get
      // sent to /dashboard, be rejected there by getUser(), come back to
      // /auth/login — and loop. Login/signup are rare, so this costs nothing
      // on everyday navigation.
      const { data } = await supabase.auth.getUser()
      user = data.user
    } else {
      const { data: { session } } = await supabase.auth.getSession()
      user = session ? true : null
      // Read-only demo, layer 1 for page paths: a non-GET request to a page
      // is a Next server action (none exist today) — refused for the demo.
      // Same token-payload read as demoReadOnlyGate (see its comment).
      if (session && SAFE_METHODS.indexOf(request.method.toUpperCase()) < 0 && accessTokenHasDemoClaim(session.access_token)) {
        const block = demoBlocked()
        supabaseResponse.cookies.getAll().forEach((c) => block.cookies.set(c))
        return block
      }
    }

    // Protect dashboard routes
    if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
      return redirectToLogin(request)
    }

    // Protect admin routes
    if (!user && request.nextUrl.pathname.startsWith('/admin')) {
      return redirectToLogin(request)
    }

    // Protect client gallery routes
    if (!user && request.nextUrl.pathname.startsWith('/client')) {
      return redirectToLogin(request)
    }

    // Redirect logged-in users away from auth pages
    if (user && (
      request.nextUrl.pathname.startsWith('/auth/login') ||
      request.nextUrl.pathname.startsWith('/auth/signup')
    )) {
      // Already signed in: go where the link was pointing, if it's ours.
      const next = safeNextPath(request.nextUrl.searchParams.get('next'))
      return NextResponse.redirect(new URL(next ?? '/dashboard', request.url))
    }

    return supabaseResponse
  } catch (error) {
    // If middleware throws, let the request through rather than 500ing.
    // Deliberately fail-OPEN for the demo gate too: failing closed would turn
    // any bug here into "every save in the Portal is broken for everyone".
    // A demo session that slips past here still meets layers 2 (RLS) and 3.
    console.error('Middleware error:', error)
    return NextResponse.next({ request })
  }
}

export const config = {
  // /api/:path* is here only for the demo read-only gate (non-GET requests
  // with a Supabase session; everything else passes straight through).
  // /auth/continue (exact path, NOT /auth/continue/verify) only for its
  // CSRF nonce cookie and session refresh — see continuePage().
  matcher: ['/dashboard/:path*', '/admin/:path*', '/client/:path*', '/auth/login', '/auth/signup', '/auth/continue', '/api/:path*'],
}
