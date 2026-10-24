import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Give the dispatcher real headroom. Without this, a Hobby function is killed at
// ~10s — long enough for trial-reminders (which sends one email at a time) to
// eat the whole budget, so the second job of the day (Tue: tips, Mon: announce)
// never got triggered. 60s is the Hobby max.
export const maxDuration = 60;

// Single daily dispatcher. Vercel's Hobby plan caps a project at 2 cron jobs, so
// instead of one cron per task we run ONE cron daily (13:00 UTC) and fan out to
// the individual cron routes based on the Eastern day of week — reproducing the
// original per-task schedules:
//   • trial-reminders  — every day
//   • news-fetch       — every day
//   • storage-report   — Monday & Thursday
//   • announce         — EVERY DAY (self-gated by approval + send window)
//   • news-digest      — Monday   (drafts the weekly piece; sends nothing)
//   • tips             — Tuesday  (self-gated by approval + weekly pacing)
//   • reel-followup    — EVERY DAY (week one + last call; each self-gated by its
//                        send window + ET date == WEEK1_/LASTCALL_AUTO_SEND_ON
//                        + email_log dedup)
//   • reel-service     — EVERY DAY (plans the month's missing Reel Service jobs)
//   • social           — EVERY DAY (due Instagram posts + unfinished IG reels)
//   • derivatives      — EVERY DAY (~50 s of photo thumbnail backfill)
//   • jobs/work        — EVERY DAY (POST; wakes the background job worker)
const PROD = "https://portal.yachtpics.com";

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

  // Eastern day of week (0 = Sun … 6 = Sat).
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dow = nowET.getDay();

  const jobs = ["/api/cron/trial-reminders"];
  // Announce runs EVERY day, not just Monday. It used to be Monday-only, which
  // meant approving a campaign on a Wednesday silently waited five days — and
  // the approve button said "Monday" while the page showed a date already in
  // the past. Running it daily makes the button mean what it looks like it
  // means: approve, and it goes out at the next 9am ET.
  //
  // Safe to call every day because it is gated three times over, and ALL three
  // must pass: the campaign's own send window, the admin approval flag in
  // app_settings, and the email_log dedup that skips anyone already sent to.
  // With no approval it is a no-op; with approval it can still only send once.
  jobs.push("/api/cron/announce");
  // Reel follow-ups (week one Sept 25, last call Sept 30). Safe daily: each only
  // sends on its own *_AUTO_SEND_ON (Eastern date) inside its window, and runReelFollowUpSend skips
  // anyone already in email_log for that campaign — so a hand send earlier, or
  // a second run the same day, can't send anyone a second copy.
  jobs.push("/api/cron/reel-followup");
  // news-digest only drafts "Yachting this week" — it never sends. It checks
  // the Eastern weekday itself too, so a stray call can't write a Thursday piece.
  if (dow === 1) jobs.push("/api/cron/storage-report", "/api/cron/news-digest");
  if (dow === 2) jobs.push("/api/cron/tips");
  if (dow === 4) jobs.push("/api/cron/storage-report");
  // Deletes the Supabase copies of migrated videos. Self-gated: sleeps until
  // Sept 7 2026 (a week after the migration), no-ops after Sept 30.
  jobs.push("/api/cron/video-cleanup");
  // Clears expired "Send to my phone" reel copies (48h) from the private bucket.
  jobs.push("/api/cron/reel-share-sweep");
  // Reads the trade press, rewrites it in the portal's voice, files it for
  // /dashboard/news. Self-gating: no AI key, no run.
  jobs.push("/api/cron/news-fetch");
  // Reel Service planner: fills the current month's missing reel jobs for
  // enrolled brokers (the whole month on the 1st; mid-month enrolments any
  // day). Idempotent, renders nothing, emails no one.
  jobs.push("/api/cron/reel-service");
  // Social publishing: sends Instagram posts whose scheduled time has passed
  // and finishes Instagram reels still processing after "Post now". Daily is
  // the Hobby limit, so this is the safety net — Facebook schedules publish on
  // Facebook's side at the exact time. Self-gating: no Meta config, no run.
  jobs.push("/api/cron/social");
  // Photo derivatives: makes the stored 600 / 2000 px copies for any photo
  // still without them (uploads whose browser request never arrived, gallery
  // photos, anything the admin backfill hasn't reached). ~50 s, newest first.
  jobs.push("/api/cron/derivatives");

  // Fire every job in PARALLEL. Each fetch triggers its own independent
  // serverless invocation with its own timeout, so a slow first job can never
  // starve the others (the bug that kept Tuesday tips / Monday announce from
  // ever firing when jobs ran sequentially).
  const results: Record<string, unknown> = {};
  // Background job queue safety net (src/lib/jobs/): wake the worker once so
  // anything queued, or left half-done by a worker that died, carries on. The
  // worker answers at once and chains itself while there's work.
  const wakeJobsWorker = async () => {
    try {
      const res = await fetch(`${PROD}/api/jobs/work`, { method: "POST", headers: { "x-jobs-secret": secret } });
      results["/api/jobs/work"] = { status: res.status, body: await res.json().catch(() => null) };
    } catch (e) {
      results["/api/jobs/work"] = { error: e instanceof Error ? e.message : String(e) };
    }
  };
  await Promise.allSettled([
    wakeJobsWorker(),
    ...jobs.map(async (path) => {
      try {
        const res = await fetch(`${PROD}${path}${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`, {
          headers: secret ? { Authorization: `Bearer ${secret}` } : {},
        });
        results[path] = { status: res.status, body: await res.json().catch(() => null) };
      } catch (e) {
        results[path] = { error: e instanceof Error ? e.message : String(e) };
      }
    }),
  ]);

  return NextResponse.json({ ok: true, dayOfWeek: dow, ran: jobs, results });
}
