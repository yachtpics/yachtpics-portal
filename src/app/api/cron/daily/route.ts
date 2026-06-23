import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Single daily dispatcher. Vercel's Hobby plan caps a project at 2 cron jobs, so
// instead of one cron per task we run ONE cron daily (13:00 UTC) and fan out to
// the individual cron routes based on the Eastern day of week — reproducing the
// original per-task schedules:
//   • trial-reminders  — every day
//   • storage-report   — Monday & Thursday
//   • announce         — Monday   (self-gated by approval + send window)
//   • tips             — Tuesday  (self-gated by approval + weekly pacing)
const PROD = "https://portal.yachtpics.com";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    const querySecret = req.nextUrl.searchParams.get("secret");
    if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Eastern day of week (0 = Sun … 6 = Sat).
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dow = nowET.getDay();

  const jobs = ["/api/cron/trial-reminders"];
  if (dow === 1) jobs.push("/api/cron/storage-report", "/api/cron/announce");
  if (dow === 2) jobs.push("/api/cron/tips");
  if (dow === 4) jobs.push("/api/cron/storage-report");

  const results: Record<string, unknown> = {};
  for (const path of jobs) {
    try {
      const res = await fetch(`${PROD}${path}${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`, {
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      });
      results[path] = { status: res.status, body: await res.json().catch(() => null) };
    } catch (e) {
      results[path] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({ ok: true, dayOfWeek: dow, ran: jobs, results });
}
