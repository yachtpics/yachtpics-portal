/**
 * Background job queue — the handlers and the one-batch worker step.
 *
 * Adding a job kind:
 *   1. add it to JOB_KINDS / JOB_LABELS in ./types.ts;
 *   2. write a handler here that does ONE batch from job.cursor before
 *      ctx.deadlineMs and returns { cursor, done, failed, total?, log?, finished }.
 *      Re-running a batch after a crash must be safe (idempotent per item);
 *   3. register it in HANDLERS (and validate its params in
 *      /api/admin/jobs → normaliseParams).
 *
 * The worker (/api/jobs/work) calls runWorkerStep(): claim the oldest job that
 * isn't leased, run one batch, save progress, and report whether to call
 * itself again.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildListingFiles, markSitePhotosBackend } from "@/lib/sitePublish";
import { ftpConfigured, uploadFiles } from "@/lib/siteFtp";
import { runDerivativeBackfill } from "@/lib/photoDerivatives";
import { isAiConfigured } from "@/lib/ai";
import { labelCategories, labelListingPhotos } from "@/lib/labelPhotos";
import { isMissingTable, jobsServiceClient } from "./queue";
import { photoOriginalsCleanup, photoOriginalsCopy, r2PhotoFinish, sitePhotosCleanup } from "./photoMigration";
import {
  JobFatalError,
  isJobFatal,
  isJobKind,
  type JobHandler,
  type JobKind,
  type JobLogLine,
  type JobRow,
  type StepResult,
} from "./types";

/** Wall-clock budget for one batch. The worker route's maxDuration is 60 s. */
export const STEP_BUDGET_MS = 40_000;
/** A worker's lease on a job; a crashed worker's lease expires after this. */
const LEASE_MS = 2 * 60_000;
/** Runaway guard: a job that hasn't finished after this many batches fails. */
export const MAX_STEPS = 2000;
/** Consecutive failed / timed-out batches before the job fails. */
const MAX_STEP_ERRORS = 3;
const LOG_KEEP = 200;

// ─── republish_site ─────────────────────────────────────────────────────────
// Same steps as POST /api/admin/listings/[id]/publish-site with publish:true
// (the route the old in-tab loop called per boat): switch publish_to_site on,
// build the boat's files, upload, and switch it back off if the upload fails.
// Re-publishing a boat twice just rewrites the same files.

const REPUBLISH_PAGE = 25;

async function republishOne(svc: SupabaseClient, listingId: string): Promise<string | null> {
  await svc.from("listings").update({ publish_to_site: true }).eq("id", listingId);
  const built = await buildListingFiles(listingId);
  if ("error" in built) return built.error;
  if (built.photosBackend !== "r2") await markSitePhotosBackend(listingId, "supabase");
  const res = await uploadFiles(built.files);
  if (!res.error && built.photosBackend === "r2") await markSitePhotosBackend(listingId, "r2");
  if (res.error) {
    await svc.from("listings").update({ publish_to_site: false, published_at: null }).eq("id", listingId);
    return res.error;
  }
  return null;
}

function liveBoatsQuery(svc: SupabaseClient, head = false) {
  return svc
    .from("listings")
    .select("id, vessel_name", head ? { count: "exact", head: true } : undefined)
    .eq("publish_to_site", true)
    .eq("status", "active")
    .eq("showcase_opt_out", false);
}

const republishSite: JobHandler = async (job, { svc, deadlineMs }) => {
  if (!ftpConfigured()) throw new JobFatalError("FTP is not configured — nothing can be published.");
  const cur = (job.cursor ?? {}) as { lastId?: string };

  let total: number | undefined;
  if (job.total == null) {
    const { count } = await liveBoatsQuery(svc, true);
    total = count ?? 0;
  }

  let q = liveBoatsQuery(svc).order("id", { ascending: true }).limit(REPUBLISH_PAGE);
  if (cur.lastId) q = q.gt("id", cur.lastId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const boats = (data ?? []) as unknown as { id: string; vessel_name: string | null }[];

  let lastId = cur.lastId;
  let done = 0;
  let failed = 0;
  const log: string[] = [];
  let slowest = 10_000;
  let processed = 0;

  for (const boat of boats) {
    // Always do at least one boat; after that only start one we expect to finish.
    if (processed > 0 && Date.now() + slowest * 1.2 > deadlineMs) break;
    const t0 = Date.now();
    const name = boat.vessel_name || "Untitled";
    let err: string | null;
    try {
      err = await republishOne(svc, boat.id);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    if (err) {
      failed++;
      log.push(`${name} — failed: ${err}`);
    } else {
      done++;
      log.push(`${name} — published`);
    }
    lastId = boat.id;
    processed++;
    slowest = Math.max(slowest, Date.now() - t0);
  }

  const finished = boats.length < REPUBLISH_PAGE && processed === boats.length;
  if (finished) log.push(`Finished — ${job.done + done} published${job.failed + failed ? `, ${job.failed + failed} failed` : ""}.`);
  return { cursor: { lastId }, done, failed, total, log, finished };
};

// ─── derivatives_backfill ───────────────────────────────────────────────────
// Wraps the existing batch backfill (src/lib/photoDerivatives.ts). The queue
// position is the photos table itself (derivatives_at null), so no cursor.
// done = copies made, failed = photos that can't be resized (marked so, never
// retried). Transient failures are retried by the next batch.

const derivativesBackfill: JobHandler = async (job, { svc, deadlineMs }) => {
  const budgetMs = Math.max(10_000, deadlineMs - Date.now());
  const r = await runDerivativeBackfill({ svc, budgetMs, concurrency: 6 });
  const total = job.total == null ? r.remaining + r.done + r.unavailable : undefined;
  const log = [
    `${r.done.toLocaleString("en-US")} photo${r.done === 1 ? "" : "s"} made${r.unavailable ? `, ${r.unavailable} can't be resized` : ""} · ${r.remaining.toLocaleString("en-US")} to go`,
  ];
  if (r.remaining <= 0) {
    log.push("Finished — every photo has stored thumbnails.");
    return { cursor: null, done: r.done, failed: r.unavailable, total, log, finished: true };
  }
  if (r.done + r.unavailable === 0) {
    // Nothing moved in a whole batch: only stubborn photos are left.
    throw new JobFatalError(
      `${r.remaining} photo${r.remaining === 1 ? "" : "s"} keep failing${r.sampleErrors[0] ? ` (${r.sampleErrors[0]})` : ""}. Try again later — the pages still work for these.`
    );
  }
  return { cursor: null, done: r.done, failed: r.unavailable, total, log, finished: false };
};

// ─── relabel_photos ─────────────────────────────────────────────────────────
// params { listingIds: string[], force?: boolean }. Labels listing by listing
// through the same helper as the listing page's Label photos button (same cost
// guards). cursor { i: listing index, pos: photo position in that listing,
// labelled: running count for the current listing's log line }.
// done / failed / total count LISTINGS.

const relabelPhotos: JobHandler = async (job, { svc, deadlineMs }) => {
  if (!isAiConfigured()) throw new JobFatalError("AI is not configured (ANTHROPIC_API_KEY is missing).");
  const ids = Array.isArray(job.params.listingIds) ? (job.params.listingIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const force = job.params.force === true;
  const cur = (job.cursor ?? {}) as { i?: number; pos?: number; labelled?: number };
  let i = cur.i ?? 0;
  let pos = cur.pos ?? 0;
  let labelled = cur.labelled ?? 0;
  let done = 0;
  let failed = 0;
  const log: string[] = [];
  const total = job.total == null ? ids.length : undefined;
  const categories = await labelCategories(svc);

  while (i < ids.length) {
    if (Date.now() + 10_000 > deadlineMs) break;
    const id = ids[i];
    const { data: listing } = await svc.from("listings").select("vessel_name").eq("id", id).maybeSingle();
    const name = (listing?.vessel_name as string | undefined) || "Untitled";
    if (!listing) {
      failed++;
      log.push(`${id.slice(0, 8)}… — listing not found, skipped`);
      i++; pos = 0; labelled = 0;
      continue;
    }
    const r = await labelListingPhotos(svc, id, { force, startPos: pos, deadlineMs, categories });
    labelled += r.updated.length;
    if (r.error) {
      // A model error (rate limit, outage): stop this batch and let the step
      // retry from the same place; three in a row fails the job.
      throw new Error(`${name}: ${r.error}`);
    }
    if (!r.complete) {
      pos = r.nextPos;
      break;
    }
    done++;
    log.push(`${name} — ${labelled} photo${labelled === 1 ? "" : "s"} labelled${r.unsure ? `, ${r.unsure} unsure` : ""}`);
    i++; pos = 0; labelled = 0;
  }

  const finished = i >= ids.length;
  if (finished) log.push(`Finished — ${job.done + done} listing${job.done + done === 1 ? "" : "s"} done.`);
  return { cursor: { i, pos, labelled }, done, failed, total, log, finished };
};

export const HANDLERS: Record<JobKind, JobHandler> = {
  republish_site: republishSite,
  derivatives_backfill: derivativesBackfill,
  relabel_photos: relabelPhotos,
  photo_originals_copy: photoOriginalsCopy,
  photo_originals_cleanup: photoOriginalsCleanup,
  site_photos_cleanup: sitePhotosCleanup,
  r2_photo_finish: r2PhotoFinish,
};

// ─── the worker step ────────────────────────────────────────────────────────

function appendLog(prev: JobLogLine[] | null | undefined, lines: string[], at: string): JobLogLine[] {
  const base = Array.isArray(prev) ? prev : [];
  return base.concat(lines.map((text) => ({ at, text }))).slice(-LOG_KEEP);
}

export type WorkerStepResult = {
  /** True when the worker should call itself again. */
  chain: boolean;
  jobId?: string;
  kind?: string;
  status?: string;
  note?: string;
  error?: string;
};

/**
 * Claim one job (oldest queued or running whose lease is free/expired) with a
 * compare-and-swap on `steps`, so two workers can never run the same batch.
 */
async function claimJob(svc: SupabaseClient): Promise<{ job: JobRow | null; error?: string; notReady?: boolean }> {
  const nowIso = new Date().toISOString();
  const { data, error } = await svc
    .from("jobs")
    .select("*")
    .in("status", ["queued", "running"])
    .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(5);
  if (error) return { job: null, error: error.message, notReady: isMissingTable(error) };

  for (const c of (data ?? []) as JobRow[]) {
    const now = new Date();
    // A lease still set means the previous batch's worker died (timed out).
    const crashed = c.status === "running" && !!c.locked_until;
    const patch: Record<string, unknown> = {
      status: "running",
      steps: c.steps + 1,
      locked_until: new Date(now.getTime() + LEASE_MS).toISOString(),
      heartbeat_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    if (!c.started_at) patch.started_at = now.toISOString();
    if (crashed) {
      patch.step_errors = c.step_errors + 1;
      patch.log = appendLog(c.log, ["A batch didn't finish (the worker timed out) — trying it again."], now.toISOString());
    }
    let q = svc.from("jobs").update(patch).eq("id", c.id).eq("steps", c.steps).in("status", ["queued", "running"]);
    q = c.locked_until ? q.eq("locked_until", c.locked_until) : q.is("locked_until", null);
    const { data: claimed } = await q.select("*").maybeSingle();
    if (claimed) return { job: claimed as JobRow };
  }
  return { job: null };
}

async function failJob(svc: SupabaseClient, job: JobRow, message: string, extraLog: string[] = []): Promise<void> {
  const now = new Date().toISOString();
  await svc
    .from("jobs")
    .update({
      status: "failed",
      error: message,
      finished_at: now,
      updated_at: now,
      heartbeat_at: now,
      locked_until: null,
      log: appendLog(job.log, extraLog.concat([`Failed: ${message}`]), now),
    })
    .eq("id", job.id)
    .eq("status", "running");
}

/** Claim one job, run ONE batch of it, save progress. */
export async function runWorkerStep(svc: SupabaseClient = jobsServiceClient()): Promise<WorkerStepResult> {
  const claim = await claimJob(svc);
  if (claim.error) return { chain: false, error: claim.notReady ? "jobs table not ready" : claim.error };
  const job = claim.job;
  if (!job) return { chain: false, note: "Nothing to do." };

  if (!isJobKind(job.kind)) {
    await failJob(svc, job, `Unknown job kind "${job.kind}".`);
    return { chain: true, jobId: job.id, kind: job.kind, status: "failed" };
  }
  if (job.steps > MAX_STEPS) {
    await failJob(svc, job, `Stopped after ${MAX_STEPS} batches without finishing — something kept it going. Check the log before retrying.`);
    return { chain: true, jobId: job.id, kind: job.kind, status: "failed" };
  }
  if (job.step_errors >= MAX_STEP_ERRORS) {
    await failJob(svc, job, `${MAX_STEP_ERRORS} batches in a row didn't finish. Retry carries on from the last saved point.`);
    return { chain: true, jobId: job.id, kind: job.kind, status: "failed" };
  }

  const deadlineMs = Date.now() + STEP_BUDGET_MS;
  let result: StepResult;
  try {
    result = await HANDLERS[job.kind](job, { svc, deadlineMs });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isJobFatal(e)) {
      await failJob(svc, job, message);
      return { chain: true, jobId: job.id, kind: job.kind, status: "failed", error: message };
    }
    const errors = job.step_errors + 1;
    if (errors >= MAX_STEP_ERRORS) {
      await failJob(svc, job, message, [`Batch failed (${errors} of ${MAX_STEP_ERRORS}): ${message}`]);
      return { chain: true, jobId: job.id, kind: job.kind, status: "failed", error: message };
    }
    const now = new Date().toISOString();
    await svc
      .from("jobs")
      .update({
        step_errors: errors,
        locked_until: null,
        heartbeat_at: now,
        updated_at: now,
        log: appendLog(job.log, [`Batch failed (${errors} of ${MAX_STEP_ERRORS}), trying again: ${message}`], now),
      })
      .eq("id", job.id)
      .eq("status", "running")
      .eq("steps", job.steps);
    return { chain: true, jobId: job.id, kind: job.kind, status: "running", error: message };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    cursor: result.cursor ?? null,
    done: job.done + (result.done || 0),
    failed: job.failed + (result.failed || 0),
    log: appendLog(job.log, result.log ?? [], now),
    heartbeat_at: now,
    updated_at: now,
    locked_until: null,
    step_errors: 0,
  };
  if (typeof result.total === "number") patch.total = result.total;
  if (result.finished) {
    patch.status = "done";
    patch.finished_at = now;
  }
  // Only if still ours and not cancelled meanwhile.
  const { data: saved } = await svc
    .from("jobs")
    .update(patch)
    .eq("id", job.id)
    .eq("status", "running")
    .eq("steps", job.steps)
    .select("id, status")
    .maybeSingle();
  if (!saved) {
    // Cancelled (or taken over) while this batch ran — don't chain for it.
    return { chain: false, jobId: job.id, kind: job.kind, status: "cancelled", note: "Job was cancelled or taken over during the batch." };
  }
  // Chain even when this job finished: another may be waiting. The next call
  // finds nothing and stops if not.
  return { chain: true, jobId: job.id, kind: job.kind, status: saved.status as string };
}
