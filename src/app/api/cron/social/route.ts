import { NextRequest, NextResponse } from "next/server";
import { metaConfigured } from "@/lib/meta/config";
import { POST_COLUMNS, advancePost, serviceClient, type SocialPostRow } from "@/lib/meta/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/social — run by the daily dispatcher (13:00 UTC, 9am ET in
 * summer / 8am in winter). Vercel Hobby only allows daily crons, so:
 *  - Instagram posts scheduled for any time go out at the first daily run on
 *    or after their time (Facebook schedules publish at the exact time on
 *    Facebook's side; this run just marks them posted).
 *  - Instagram reels left 'posting' (still processing when the publish
 *    request hit its time limit) are published.
 * Immediate posts are the main path; this is the safety net.
 * Self-gating: does nothing until Meta is configured.
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
  if (!metaConfigured()) return NextResponse.json({ ok: true, skipped: "Meta not configured" });

  const svc = serviceClient();
  const nowIso = new Date().toISOString();
  const [{ data: due, error }, { data: posting }] = await Promise.all([
    svc.from("social_posts").select(POST_COLUMNS).eq("status", "scheduled").lte("scheduled_for", nowIso).order("scheduled_for").limit(20),
    svc.from("social_posts").select(POST_COLUMNS).eq("status", "posting").order("created_at").limit(20),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message });

  const list = ((posting ?? []) as SocialPostRow[]).concat((due ?? []) as SocialPostRow[]);
  const deadlineMs = Date.now() + 45_000;
  const results: { id: string; platform: string; from: string; to: string | null }[] = [];
  await Promise.all(list.map(async (p) => {
    const r = await advancePost(svc, p, deadlineMs);
    results.push({ id: p.id, platform: p.platform, from: p.status, to: r?.status ?? null });
  }));
  return NextResponse.json({ ok: true, checked: list.length, results });
}
