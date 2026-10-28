import { NextRequest, NextResponse } from "next/server";
import { jobsServiceClient, isMissingTable, runInBackground } from "@/lib/jobs/queue";
import { runWorkerStep } from "@/lib/jobs/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A running job whose last sign of life is older than this counts as stalled. */
const STALE_MS = 90_000;

/**
 * GET|POST /api/jobs/tick — the once-a-minute heartbeat for background jobs.
 *
 * Why: the worker (/api/jobs/work) chains itself by calling its own URL, and
 * Vercel can refuse that call with 508 (loop detection — seen Oct 28 during
 * the Sanibella upload), which leaves a job "running" with nobody working on
 * it. This route doesn't depend on that chain: it's called from OUTSIDE
 * (Supabase pg_cron + pg_net, every minute — migration
 * 20261028f_jobs_tick_cron.sql; Vercel Hobby only allows daily crons) so every
 * call is a fresh request with no loop history.
 *
 * Cheap when idle: ONE small query on `jobs`. If an active job has no live
 * worker (queued and not leased, or running with an expired lease and no
 * heartbeat for 90 s), it answers at once and runs ONE batch in this same
 * invocation (waitUntil, ~40 s — no self-fetch). A healthy chain is left alone.
 *
 * Auth: JOBS_TICK_SECRET (or CRON_SECRET) as `Authorization: Bearer …` or `x-jobs-secret`; fails
 * closed when it isn't set.
 */
async function handle(req: NextRequest) {
  // JOBS_TICK_SECRET (shared with the Supabase Vault secret `jobs_cron_secret`)
  // is preferred; CRON_SECRET is still accepted.
  const secrets = [process.env.JOBS_TICK_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length >= 16,
  );
  if (secrets.length === 0) return NextResponse.json({ error: "JOBS_TICK_SECRET not configured" }, { status: 500 });
  const bearer = req.headers.get("authorization");
  const given = req.headers.get("x-jobs-secret");
  const ok = secrets.some((s) => bearer === `Bearer ${s}` || given === s);
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = jobsServiceClient();
  const { data, error } = await svc
    .from("jobs")
    .select("id, status, locked_until, heartbeat_at")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) {
    return NextResponse.json({ idle: true, note: isMissingTable(error) ? "jobs table missing" : error.message });
  }
  const now = Date.now();
  const stalled = (data ?? []).filter((j) => {
    const leased = !!j.locked_until && Date.parse(j.locked_until as string) > now;
    if (leased) return false;
    if (j.status === "queued") return true;
    return !j.heartbeat_at || now - Date.parse(j.heartbeat_at as string) > STALE_MS;
  });
  if (stalled.length === 0) return NextResponse.json({ idle: true, active: (data ?? []).length });

  // One batch, kept alive with waitUntil after answering (the caller —
  // pg_net — doesn't wait 40 s). No self-fetch: the next tick, a minute
  // later, carries on if the worker's own chain can't.
  runInBackground(runWorkerStep(svc));
  return NextResponse.json({ started: true, stalled: stalled.length }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
