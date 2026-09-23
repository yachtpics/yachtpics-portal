import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  try {
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
    }

    // Protect dashboard routes
    if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    // Protect admin routes
    if (!user && request.nextUrl.pathname.startsWith('/admin')) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    // Protect client gallery routes
    if (!user && request.nextUrl.pathname.startsWith('/client')) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    // Redirect logged-in users away from auth pages
    if (user && (
      request.nextUrl.pathname.startsWith('/auth/login') ||
      request.nextUrl.pathname.startsWith('/auth/signup')
    )) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    return supabaseResponse
  } catch (error) {
    // If middleware throws, let the request through rather than 500ing
    console.error('Middleware error:', error)
    return NextResponse.next({ request })
  }
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/client/:path*', '/auth/login', '/auth/signup'],
}
