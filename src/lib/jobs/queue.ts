/**
 * Background job queue — enqueue / cancel / retry / list, and the "kick" that
 * wakes the worker. Server only (service role).
 *
 * How it runs: a row goes into `jobs` (migration 20261023c_jobs.sql), then
 * kickWorker() POSTs /api/jobs/work with the `x-jobs-secret` header. The
 * worker answers at once, runs ONE ~40 s batch in the background (waitUntil),
 * saves progress, and POSTs itself again until the job is finished. The daily
 * cron also POSTs the worker once as a safety net for anything left waiting.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { isActiveStatus, type JobKind, type JobRow } from "./types";

export const JOBS_NOT_READY =
  "Background jobs aren't set up yet (the jobs table is missing — apply migration 20261023c_jobs.sql).";

const PROD = "https://portal.yachtpics.com";

export function jobsServiceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** True when a Supabase error means "the jobs table doesn't exist yet". */
export function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  return /relation .*jobs.* does not exist|could not find the table/i.test(err.message ?? "");
}

/** Key order doesn't matter for "the same job": compare params this way. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export type EnqueueResult =
  | { job: JobRow; existing: boolean; error?: undefined; notReady?: undefined }
  | { error: string; notReady?: boolean; job?: undefined; existing?: undefined };

async function findActive(svc: SupabaseClient, kind: JobKind, params: Record<string, unknown>) {
  const { data, error } = await svc
    .from("jobs")
    .select("*")
    .eq("kind", kind)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true });
  if (error) return { error };
  const key = stableStringify(params);
  const match = ((data ?? []) as JobRow[]).find((j) => stableStringify(j.params) === key) ?? null;
  return { job: match };
}

/**
 * Queue a job. If an identical one (same kind + params) is already queued or
 * running, nothing new is created and that row comes back (`existing: true`).
 * Doesn't wake the worker — call kickWorker() after.
 */
export async function enqueueJob(
  kind: JobKind,
  params: Record<string, unknown>,
  userId: string | null,
  svc: SupabaseClient = jobsServiceClient()
): Promise<EnqueueResult> {
  const found = await findActive(svc, kind, params);
  if (found.error) {
    if (isMissingTable(found.error)) return { error: JOBS_NOT_READY, notReady: true };
    return { error: found.error.message };
  }
  if (found.job) return { job: found.job, existing: true };

  const { data, error } = await svc
    .from("jobs")
    .insert({ kind, params, status: "queued", created_by: userId })
    .select("*")
    .single();
  if (error) {
    if (isMissingTable(error)) return { error: JOBS_NOT_READY, notReady: true };
    // Lost a race with an identical request (unique index jobs_one_active_idx).
    if (error.code === "23505") {
      const again = await findActive(svc, kind, params);
      if (again.job) return { job: again.job, existing: true };
    }
    return { error: error.message };
  }
  return { job: data as JobRow, existing: false };
}

/** Stop a queued/running job. The worker notices before its next batch. */
export async function cancelJob(
  id: string,
  svc: SupabaseClient = jobsServiceClient()
): Promise<{ job?: JobRow; error?: string; notReady?: boolean }> {
  const now = new Date().toISOString();
  const { data, error } = await svc
    .from("jobs")
    .update({ status: "cancelled", finished_at: now, updated_at: now, locked_until: null })
    .eq("id", id)
    .in("status", ["queued", "running"])
    .select("*")
    .maybeSingle();
  if (error) return isMissingTable(error) ? { error: JOBS_NOT_READY, notReady: true } : { error: error.message };
  if (!data) {
    const cur = await getJob(id, svc);
    if (cur.job && !isActiveStatus(cur.job.status)) return { job: cur.job };
    return { error: "Job not found" };
  }
  return { job: data as JobRow };
}

/**
 * Put a failed (or cancelled) job back in the queue. It resumes from its
 * cursor, keeping the counts and log so far.
 */
export async function retryJob(
  id: string,
  svc: SupabaseClient = jobsServiceClient()
): Promise<{ job?: JobRow; error?: string; notReady?: boolean }> {
  const now = new Date().toISOString();
  const { data: cur, error: readErr } = await svc.from("jobs").select("*").eq("id", id).maybeSingle();
  if (readErr) return isMissingTable(readErr) ? { error: JOBS_NOT_READY, notReady: true } : { error: readErr.message };
  if (!cur) return { error: "Job not found" };
  const job = cur as JobRow;
  if (job.status !== "failed" && job.status !== "cancelled") return { error: "Only a failed or cancelled job can be retried." };

  const log = (Array.isArray(job.log) ? job.log : []).concat([{ at: now, text: "Retried — carrying on from where it stopped." }]).slice(-200);
  const { data, error } = await svc
    .from("jobs")
    .update({
      status: "queued",
      error: null,
      finished_at: null,
      locked_until: null,
      step_errors: 0,
      steps: 0,
      log,
      updated_at: now,
    })
    .eq("id", id)
    .in("status", ["failed", "cancelled"])
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return { error: "The same job is already queued or running." };
    return { error: error.message };
  }
  if (!data) return { error: "Job changed meanwhile — reload and try again." };
  return { job: data as JobRow };
}

export async function getJob(
  id: string,
  svc: SupabaseClient = jobsServiceClient()
): Promise<{ job?: JobRow | null; error?: string; notReady?: boolean }> {
  const { data, error } = await svc.from("jobs").select("*").eq("id", id).maybeSingle();
  if (error) return isMissingTable(error) ? { error: JOBS_NOT_READY, notReady: true } : { error: error.message };
  return { job: (data as JobRow) ?? null };
}

/** The newest 20 jobs plus anything still queued/running, newest first. */
export async function listJobs(
  opts: { kind?: JobKind; activeOnly?: boolean } = {},
  svc: SupabaseClient = jobsServiceClient()
): Promise<{ jobs?: JobRow[]; error?: string; notReady?: boolean }> {
  let recentQ = svc.from("jobs").select("*").order("created_at", { ascending: false }).limit(20);
  let activeQ = svc.from("jobs").select("*").in("status", ["queued", "running"]).order("created_at", { ascending: false });
  if (opts.kind) {
    recentQ = recentQ.eq("kind", opts.kind);
    activeQ = activeQ.eq("kind", opts.kind);
  }
  const [recent, active] = await Promise.all([opts.activeOnly ? Promise.resolve({ data: [], error: null }) : recentQ, activeQ]);
  const err = recent.error ?? active.error;
  if (err) return isMissingTable(err) ? { error: JOBS_NOT_READY, notReady: true } : { error: err.message };
  const seen = new Set<string>();
  const out: JobRow[] = [];
  ((active.data ?? []) as JobRow[]).concat((recent.data ?? []) as JobRow[]).forEach((j) => {
    if (seen.has(j.id)) return;
    seen.add(j.id);
    out.push(j);
  });
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { jobs: out };
}

/**
 * Absolute base URL for the worker's self-calls. NEXT_PUBLIC_SITE_URL if set,
 * else the origin the request came in on (portal.yachtpics.com in prod), else
 * VERCEL_URL, else production. The request origin beats VERCEL_URL because
 * deployment URLs can sit behind Vercel's deployment protection.
 */
export function jobsBaseUrl(req?: { nextUrl?: { origin: string }; url?: string } | null): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/+$/, "");
  const origin = req?.nextUrl?.origin ?? (req?.url ? new URL(req.url).origin : null);
  if (origin && /^https?:\/\//.test(origin)) return origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return PROD;
}

/**
 * Keep a promise alive after the response is sent. On Vercel this is
 * waitUntil(); off Vercel (next dev) waitUntil has no request context and does
 * nothing, but the promise is already running in the long-lived Node process,
 * so leaving it un-awaited is the fallback. Errors are swallowed (logged).
 */
export function runInBackground(p: Promise<unknown>): void {
  const safe = p.catch((e) => {
    console.error("[jobs] background task failed:", e instanceof Error ? e.message : e);
  });
  try {
    waitUntil(safe);
  } catch {
    // No Vercel request context — `safe` keeps running on its own.
  }
}

/**
 * POST the worker once. Resolves when the worker has ACCEPTED the call (it
 * answers 202 straight away and works in the background), so awaiting this
 * costs a second or two, not a whole batch.
 */
export async function callWorker(baseUrl: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, error: "CRON_SECRET not configured" };
  try {
    const res = await fetch(`${baseUrl}/api/jobs/work`, {
      method: "POST",
      headers: { "x-jobs-secret": secret },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    await res.text().catch(() => "");
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fire-and-forget wake-up for the worker (after enqueue / retry). */
export function kickWorker(baseUrl: string): void {
  runInBackground(callWorker(baseUrl));
}
