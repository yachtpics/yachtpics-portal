import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { callWorker, jobsBaseUrl, runInBackground } from "@/lib/jobs/queue";
import { runWorkerStep } from "@/lib/jobs/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One batch is ~40 s of work (STEP_BUDGET_MS) plus the hand-off to the next
// call; 60 s is the Hobby max, set per route like the other long routes.
export const maxDuration = 60;

/**
 * POST /api/jobs/work → 202 { accepted: true }
 * POST /api/jobs/work?wait=1 → { chain, jobId, kind, status, note?, error? }
 *
 * The background job worker (src/lib/jobs/). Answers straight away, then — kept
 * alive with waitUntil — claims the oldest waiting job (or a running one whose
 * worker died: its lease ran out), runs ONE batch, saves progress, and if
 * there may be more to do POSTs itself again. Each call is its own invocation,
 * so a job of any length finishes without a browser tab open.
 *
 * Who may call: the header `x-jobs-secret` = CRON_SECRET (the worker's own
 * chain, the enqueue kick and the daily cron) or a signed-in admin. Like the
 * cron routes it fails closed when CRON_SECRET isn't set — without it the
 * chain can't call itself.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("x-jobs-secret") !== secret) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
  }

  const baseUrl = jobsBaseUrl(req);
  const work = runWorkerStep().then(async (r) => {
    if (r.chain) {
      const next = await callWorker(baseUrl);
      if (!next.ok) console.error("[jobs] couldn't chain the next batch:", next.status ?? next.error);
    }
    return r;
  });

  if (req.nextUrl.searchParams.get("wait") === "1") {
    try {
      return NextResponse.json(await work);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  runInBackground(work);
  return NextResponse.json({ accepted: true }, { status: 202 });
}
