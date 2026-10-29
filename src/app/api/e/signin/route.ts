import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/publicSlideshow";
import { recordSigninAttribution } from "@/lib/emailTracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Called by the login / magic-link pages right after a successful sign-in. */
export async function POST(req: Request) {
  try {
    const { data: { user } } = await (await createClient()).auth.getUser();
    if (user) await recordSigninAttribution(serviceClient(), user.id, req.headers.get("user-agent"));
  } catch {
    /* never in the way of signing in */
  }
  return new NextResponse(null, { status: 204 });
}
