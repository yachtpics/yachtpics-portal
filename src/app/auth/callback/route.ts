import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { safeNextPath } from '@/lib/safeNext'
import { serviceClient } from '@/lib/publicSlideshow'
import { recordSigninAttribution } from '@/lib/emailTracking'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Only honour same-site relative paths ("/foo"), never "//evil.com",
  // backslash tricks or anything with a scheme.
  const next = safeNextPath(searchParams.get('next')) ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Credit a recent campaign email with this sign-in (never blocks it).
      if (data.user) await recordSigninAttribution(serviceClient(), data.user.id, request.headers.get('user-agent'))
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth_error`)
}
