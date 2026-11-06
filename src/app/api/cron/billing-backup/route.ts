import { NextRequest, NextResponse } from "next/server";
import { enqueueJob, jobsBaseUrl, kickWorker } from "@/lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Queues the weekly billing backup (job kind `billing_backup`). Called on
 * Sundays by /api/cron/daily; the job worker (and the once-a-minute
 * jobs-tick) runs it. Idempotent: an already-queued backup is reused.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  const authHeader = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const r = await enqueueJob("billing_backup", {}, null);
  if (r.error !== undefined) return NextResponse.json({ ok: false, error: r.error });
  kickWorker(jobsBaseUrl(req));
  return NextResponse.json({ ok: true, job: r.job?.id, existing: r.existing });
}
