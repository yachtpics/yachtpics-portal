import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { periodET, planReelServiceMonth } from "@/lib/reelService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reel Service planner, called daily by /api/cron/daily.
 *
 * Plans the current month (Eastern time). On the 1st that writes the whole
 * month's jobs for every active listing of every enrolled broker; every other day it is a no-op
 * unless something is missing — a broker enrolled (or re-enabled) mid-month,
 * a listing that went active mid-month (it gets its full set), or
 * reels_per_listing raised. Idempotent: it only fills missing slots.
 * Renders nothing and emails no one.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    const querySecret = req.nextUrl.searchParams.get("secret");
    if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const period = periodET();
  try {
    const result = await planReelServiceMonth(admin, period);
    return NextResponse.json({ ok: true, period, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, period, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
