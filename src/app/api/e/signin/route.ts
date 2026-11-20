import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/publicSlideshow";
import { recordSigninAttribution } from "@/lib/emailTracking";
import { isDemoUser } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Called by the login / magic-link pages right after a successful sign-in. */
export async function POST(req: Request) {
  try {
    const { data: { user } } = await (await createClient()).auth.getUser();
    // Read-only demo (layer 3): record nothing; the sign-in flow still gets its 204.
    if (user && !isDemoUser(user)) await recordSigninAttribution(serviceClient(), user.id, req.headers.get("user-agent"));
  } catch {
    /* never in the way of signing in */
  }
  return new NextResponse(null, { status: 204 });
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
