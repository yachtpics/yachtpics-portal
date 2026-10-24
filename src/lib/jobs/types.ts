/**
 * Background job queue — shared types. Safe to import from client components
 * (no server-only imports here). The queue itself is src/lib/jobs/queue.ts,
 * the handlers src/lib/jobs/runner.ts, the worker /api/jobs/work.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const JOB_KINDS = ["republish_site", "derivatives_backfill", "relabel_photos"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export function isJobKind(x: unknown): x is JobKind {
  return typeof x === "string" && (JOB_KINDS as readonly string[]).indexOf(x) >= 0;
}

/** What the admin pages call each kind. */
export const JOB_LABELS: Record<JobKind, string> = {
  republish_site: "Re-publish live boats",
  derivatives_backfill: "Photo thumbnails",
  relabel_photos: "Label photos",
};

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type JobLogLine = { at: string; text: string };

export type JobRow = {
  id: string;
  kind: JobKind;
  params: Record<string, unknown>;
  status: JobStatus;
  total: number | null;
  done: number;
  failed: number;
  cursor: unknown;
  log: JobLogLine[];
  error: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  heartbeat_at: string | null;
  finished_at: string | null;
  updated_at: string;
  locked_until: string | null;
  steps: number;
  step_errors: number;
};

export function isActiveStatus(s: JobStatus): boolean {
  return s === "queued" || s === "running";
}

/** What a handler is given for one batch. */
export type StepContext = {
  /** Service-role client. */
  svc: SupabaseClient;
  /** Absolute time (epoch ms) by which the batch should be wrapped up. */
  deadlineMs: number;
};

/**
 * One batch's outcome. `done` / `failed` are INCREMENTS for this batch (the
 * runner adds them to the row). `total` replaces the row's total when given.
 * `log` lines are appended. `finished` = nothing left to do.
 */
export type StepResult = {
  cursor: unknown;
  done: number;
  failed: number;
  total?: number;
  log?: string[];
  finished: boolean;
};

/**
 * A handler processes ONE batch from job.cursor within ctx.deadlineMs and
 * must be idempotent per item: if a worker dies mid-batch, the same batch
 * runs again from the old cursor.
 */
export type JobHandler = (job: JobRow, ctx: StepContext) => Promise<StepResult>;

/** Throw from a handler to fail the job at once (no retries). */
export class JobFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobFatalError";
    // tsconfig has no target (ES5 for tsc): keep instanceof working anyway.
    Object.setPrototypeOf(this, JobFatalError.prototype);
  }
}

export function isJobFatal(e: unknown): boolean {
  return e instanceof JobFatalError || (e instanceof Error && e.name === "JobFatalError");
}
