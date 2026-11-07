import { NextRequest, NextResponse } from "next/server";
import { enqueueJob, jobsBaseUrl, kickWorker } from "@/lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Queues today's payment reminders (job kind `billing_reminders`). Called
 * EVERY day by /api/cron/daily (13:00 UTC = 8 am EST / 9 am EDT); the job
 * worker (and the once-a-minute jobs-tick) runs it — src/lib/books/reminders.ts.
 * Idempotent twice over: an already-queued run is reused, and the job itself
 * never sends the same reminder step twice (billing_reminders_sent).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  const authHeader = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const r = await enqueueJob("billing_reminders", {}, null);
  if (r.error !== undefined) return NextResponse.json({ ok: false, error: r.error });
  kickWorker(jobsBaseUrl(req));
  return NextResponse.json({ ok: true, job: r.job?.id, existing: r.existing });
}
