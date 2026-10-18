import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { runDerivativeBackfill } from "@/lib/photoDerivatives";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET  /api/admin/derivatives/run → { remaining }            (count only)
 * POST /api/admin/derivatives/run → { done, unavailable, failed, remaining, sampleErrors }
 *
 * The "Generate thumbnails" button on Admin → Overview calls POST over and
 * over from the browser until remaining = 0. Each call works ~45 s (6 photos
 * at a time), so no single request nears the 60 s limit, and closing the tab
 * just stops it — the next press (or the daily cron) carries on where it left
 * off. Admin only.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { count, error } = await auth.admin
    .from("photos")
    .select("id", { count: "exact", head: true })
    .is("derivatives_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ remaining: count ?? 0 });
}

export async function POST(_req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  try {
    const r = await runDerivativeBackfill({ svc: auth.admin, budgetMs: 45_000, concurrency: 6 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
