import { NextRequest, NextResponse } from "next/server";
import { runDerivativeBackfill } from "@/lib/photoDerivatives";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/derivatives → { done, unavailable, failed, remaining }
 *
 * Backfill for pre-generated photo derivatives (src/lib/photoDerivatives.ts):
 * makes the 600 / 2000 WebP copies for photos with derivatives_at = null,
 * newest first, for ~50 s, then stops. Fired daily by /api/cron/daily as the
 * safety net for uploads whose fire-and-forget request never arrived (and for
 * gallery photos, which have no upload trigger). The big one-off backfill is
 * the admin button on Admin → Overview (/api/admin/derivatives/run).
 *
 * CRON_SECRET protected (Bearer header or ?secret=); fails closed if unset.
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

  try {
    const r = await runDerivativeBackfill({ budgetMs: 50_000, concurrency: 4 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
