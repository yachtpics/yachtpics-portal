"use client";

import { useEffect, useRef, useState } from "react";
import { JOB_LABELS, isActiveStatus, type JobKind, type JobRow } from "@/lib/jobs/types";

/**
 * Compact progress card for a background job (src/lib/jobs/). Polls the job
 * every 3 s while it's queued or running: label, progress bar, done/total,
 * the last 3 log lines, elapsed time, Cancel. The work runs on the server, so
 * closing the tab doesn't stop it — reopening the page shows it again.
 */

export type StartJobResult =
  | { job: JobRow; existing: boolean; notReady?: undefined; error?: undefined }
  | { job?: undefined; notReady: true; error: string }
  | { job?: undefined; notReady?: false; error: string };

/** Queue a job. `notReady` = the jobs table isn't there yet (fall back). */
export async function startJob(kind: JobKind, params: Record<string, unknown> = {}): Promise<StartJobResult> {
  try {
    const res = await fetch("/api/admin/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "enqueue", kind, params }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.job) return { job: data.job as JobRow, existing: !!data.existing };
    if (data.notReady) return { notReady: true, error: data.error ?? "Background jobs aren't set up yet." };
    return { error: data.error ?? `The server answered ${res.status}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Network error" };
  }
}

/** The newest queued/running job of this kind, if any (null also when not set up). */
export async function fetchActiveJob(kind: JobKind): Promise<JobRow | null> {
  try {
    const res = await fetch(`/api/admin/jobs?kind=${kind}&active=1`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const jobs = (data.jobs ?? []) as JobRow[];
    return jobs[0] ?? null;
  } catch {
    return null;
  }
}

function elapsed(from: string | null, to: string | null): string {
  if (!from) return "";
  const ms = Math.max(0, (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime());
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const STATUS_TEXT: Record<JobRow["status"], string> = {
  queued: "Waiting to start…",
  running: "Running on the server",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default function JobProgress({
  job: initial,
  title,
  onFinished,
  compact = false,
}: {
  job: JobRow;
  /** Overrides the kind's label. */
  title?: string;
  /** Called once when the job leaves queued/running. */
  onFinished?: (job: JobRow) => void;
  /** Drop the outer card (when it sits inside another card). */
  compact?: boolean;
}) {
  const [job, setJob] = useState<JobRow>(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const finishedRef = useRef(!isActiveStatus(initial.status));
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    setJob(initial);
    finishedRef.current = !isActiveStatus(initial.status);
  }, [initial]);

  const active = isActiveStatus(job.status);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/jobs?id=${job.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!stopped && data.job) {
          const next = data.job as JobRow;
          setJob(next);
          if (!isActiveStatus(next.status) && !finishedRef.current) {
            finishedRef.current = true;
            onFinishedRef.current?.(next);
          }
        }
      } catch {
        // Try again on the next tick.
      }
    };
    const t = setInterval(poll, 3000);
    const clock = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      stopped = true;
      clearInterval(t);
      clearInterval(clock);
    };
  }, [active, job.id]);

  async function cancel() {
    if (!confirm("Cancel this job? Whatever is already done stays done.")) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", id: job.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't cancel.");
      if (data.job) {
        setJob(data.job);
        if (!finishedRef.current) {
          finishedRef.current = true;
          onFinishedRef.current?.(data.job);
        }
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't cancel.");
    } finally {
      setBusy(false);
    }
  }

  const label = title ?? JOB_LABELS[job.kind] ?? job.kind;
  const processed = job.done + job.failed;
  const pct = job.total ? Math.min(100, Math.round((processed / job.total) * 100)) : job.status === "done" ? 100 : 0;
  const lines = (Array.isArray(job.log) ? job.log : []).slice(-3);
  const tone =
    job.status === "failed" ? "text-danger-700" : job.status === "done" ? "text-success-700" : job.status === "cancelled" ? "text-warn-700" : "text-ink-500";

  return (
    <div className={compact ? "" : "bg-white border border-hairline rounded-card shadow-elev-1 p-4"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900 truncate">{label}</p>
          <p className={`text-xs mt-0.5 ${tone}`}>
            {STATUS_TEXT[job.status]}
            {job.started_at ? ` · ${elapsed(job.started_at, active ? null : job.finished_at)}` : ""}
            {active ? " · you can close this tab" : ""}
          </p>
        </div>
        {active && (
          <button
            onClick={cancel}
            disabled={busy}
            className="shrink-0 bg-white border border-hairline hover:bg-ink-50 disabled:opacity-50 text-ink-900 text-xs font-semibold px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="mt-3 h-1.5 bg-ink-100 rounded-full overflow-hidden">
        <div className="h-full bg-accent-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-ink-500 mt-1.5 tabular-nums">
        {processed.toLocaleString("en-US")}
        {job.total != null ? ` / ${job.total.toLocaleString("en-US")}` : ""}
        {job.failed > 0 ? ` · ${job.failed.toLocaleString("en-US")} failed` : ""}
      </p>

      {lines.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {lines.map((l, i) => (
            <li key={`${l.at}-${i}`} className="text-xs text-ink-600 truncate">
              {l.text}
            </li>
          ))}
        </ul>
      )}

      {job.status === "failed" && job.error && <p className="mt-2 text-xs text-danger-700">{job.error}</p>}
      {note && <p className="mt-2 text-xs text-danger-700">{note}</p>}
    </div>
  );
}
