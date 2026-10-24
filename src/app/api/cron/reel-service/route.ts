import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { periodET, planReelServiceMonth } from "@/lib/reelService";
import { endReelServiceForInactiveListings } from "@/lib/reelServiceStripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reel Service planner, called daily by /api/cron/daily.
 *
 * Plans the current month (Eastern time). On the 1st that writes the whole
 * month's jobs for every boat enrolled in the Reel Service (reel_service_listings;
 * all active listings for a broker with no boats chosen yet); every other day it is a no-op
 * unless something is missing — a broker enrolled (or re-enabled) mid-month,
 * a boat enrolled or a listing that went active mid-month (it gets its full set), or
 * reels_per_listing raised. Idempotent: it only fills missing slots.
 * Renders nothing and emails no one.
 *
 * Also (Oct 24): a paid Reel Service boat whose listing is no longer active
 * (sold / archived) is set to cancel at the end of its paid month in Stripe.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const period = periodET();
  let sold: { ended: number; errors: string[] } = { ended: 0, errors: [] };
  try { sold = await endReelServiceForInactiveListings(admin); } catch (e) {
    sold.errors.push(e instanceof Error ? e.message : String(e));
  }
  try {
    const result = await planReelServiceMonth(admin, period);
    return NextResponse.json({ ok: true, period, ...result, soldEnded: sold.ended, soldErrors: sold.errors });
  } catch (e) {
    return NextResponse.json({ ok: false, period, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
