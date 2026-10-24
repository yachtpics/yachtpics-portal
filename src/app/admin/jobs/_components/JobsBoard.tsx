"use client";

import { useCallback, useEffect, useState } from "react";
import JobProgress, { startJob } from "@/components/admin/JobProgress";
import { JOB_LABELS, isActiveStatus, type JobKind, type JobRow } from "@/lib/jobs/types";
import { formatDateTimeET } from "@/lib/datetime";

const STATUS_CHIP: Record<JobRow["status"], string> = {
  queued: "bg-ink-100 text-ink-700",
  running: "bg-accent-100 text-accent-800",
  done: "bg-success-50 text-success-700",
  failed: "bg-danger-50 text-danger-700",
  cancelled: "bg-warn-50 text-warn-700",
};

function jobTitle(job: JobRow): string {
  const base = JOB_LABELS[job.kind] ?? job.kind;
  if (job.kind === "relabel_photos" && Array.isArray(job.params?.listingIds)) {
    const n = (job.params.listingIds as unknown[]).length;
    return `${base} · ${n} listing${n === 1 ? "" : "s"}`;
  }
  return base;
}

const STARTERS: { kind: JobKind; params: Record<string, unknown>; label: string; hint: string; confirm: string }[] = [
  {
    kind: "republish_site",
    params: {},
    label: "Re-publish live boats",
    hint: "Refresh every boat on yachtpics.com.",
    confirm: "Re-publish every boat currently on yachtpics.com? Boats you've hand-arranged keep their order.",
  },
  {
    kind: "derivatives_backfill",
    params: {},
    label: "Generate photo thumbnails",
    hint: "Make the stored small and large copies for photos that don't have them.",
    confirm: "Generate stored thumbnails for every photo still without them?",
  },
  {
    kind: "relabel_photos",
    params: { scope: "unlabelled" },
    label: "Label photos still marked Other",
    hint: "Every active listing — photos set by hand or already labelled are left alone.",
    confirm:
      "Let the AI label photos still marked Other (or blank) on every active listing? This uses AI credits (8 photos per call). Photos you or a broker set by hand are never changed.",
  },
];

export default function JobsBoard() {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openLog, setOpenLog] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/jobs", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 && data.notReady) {
        setNotReady(true);
        setJobs([]);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}`);
      setNotReady(false);
      setJobs(data.jobs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load jobs.");
      setJobs((j) => j ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the list fresh while anything is running (the cards poll themselves).
  const anyActive = (jobs ?? []).some((j) => isActiveStatus(j.status));
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [anyActive, load]);

  async function start(s: (typeof STARTERS)[number]) {
    if (!confirm(s.confirm)) return;
    setBusy(s.kind);
    setError(null);
    const r = await startJob(s.kind, s.params);
    setBusy(null);
    if (r.job) {
      if (r.existing) setError(`${JOB_LABELS[s.kind]} is already queued or running — showing that one.`);
      await load();
      return;
    }
    if (r.notReady) setNotReady(true);
    setError(r.error);
  }

  async function retry(job: JobRow) {
    setBusy(job.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", id: job.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't retry.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't retry.");
    } finally {
      setBusy(null);
    }
  }

  const active = (jobs ?? []).filter((j) => isActiveStatus(j.status));

  return (
    <div className="space-y-6">
      {notReady && (
        <div className="px-4 py-3 rounded-ctl text-sm bg-warn-50 border border-warn-200 text-warn-700">
          Background jobs aren&apos;t set up yet — the jobs table is missing (migration 20261023c_jobs.sql). Until
          then, Re-publish live boats and Photo thumbnails on the Overview page run in the browser tab as before.
        </div>
      )}
      {error && (
        <div className="px-4 py-3 rounded-ctl text-sm bg-danger-50 border border-danger-200 text-danger-700">{error}</div>
      )}

      {/* Start a job */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
        <h2 className="font-semibold text-ink-900 mb-3">Start a job</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {STARTERS.map((s) => {
            const running = active.some((j) => j.kind === s.kind);
            return (
              <div key={s.kind} className="border border-hairline rounded-ctl p-3 flex flex-col">
                <p className="text-sm font-semibold text-ink-900">{s.label}</p>
                <p className="text-xs text-ink-500 mt-1 flex-1">{s.hint}</p>
                <button
                  onClick={() => start(s)}
                  disabled={notReady || busy !== null || running}
                  className="mt-3 self-start bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet"
                >
                  {busy === s.kind ? "Starting…" : running ? "Running" : "Start"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Running now */}
      {active.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-h2 text-ink-900">Running now</h2>
          {active.map((j) => (
            <JobProgress key={j.id} job={j} title={jobTitle(j)} onFinished={() => load()} />
          ))}
        </div>
      )}

      {/* Recent */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1">
        <div className="px-6 py-4 border-b border-hairline">
          <h2 className="text-h2 text-ink-900">Recent jobs</h2>
        </div>
        {jobs === null ? (
          <p className="px-6 py-8 text-sm text-ink-500">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="px-6 py-8 text-sm text-ink-500">No jobs yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {jobs.map((j) => {
              const lines = Array.isArray(j.log) ? j.log : [];
              return (
                <li key={j.id} className="px-6 py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="text-sm font-medium text-ink-900 min-w-0 flex-1 truncate">{jobTitle(j)}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_CHIP[j.status]}`}>{j.status}</span>
                    <span className="text-xs text-ink-500 tabular-nums">
                      {(j.done + j.failed).toLocaleString("en-US")}
                      {j.total != null ? ` / ${j.total.toLocaleString("en-US")}` : ""}
                      {j.failed > 0 ? ` · ${j.failed} failed` : ""}
                    </span>
                    {(j.status === "failed" || j.status === "cancelled") && (
                      <button
                        onClick={() => retry(j)}
                        disabled={busy !== null}
                        className="text-xs font-semibold text-accent-700 hover:text-accent-800 disabled:opacity-50"
                      >
                        {busy === j.id ? "Retrying…" : "Retry"}
                      </button>
                    )}
                    {lines.length > 0 && (
                      <button
                        onClick={() => setOpenLog(openLog === j.id ? null : j.id)}
                        className="text-xs text-ink-500 hover:text-ink-800"
                      >
                        {openLog === j.id ? "Hide log" : "Log"}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-ink-400 mt-1">
                    Queued {formatDateTimeET(j.created_at)}
                    {j.started_at ? ` · started ${formatDateTimeET(j.started_at)}` : ""}
                    {j.finished_at ? ` · finished ${formatDateTimeET(j.finished_at)}` : ""}
                  </p>
                  {j.error && <p className="text-xs text-danger-700 mt-1">{j.error}</p>}
                  {openLog === j.id && (
                    <ul className="mt-2 max-h-64 overflow-auto bg-ink-50 rounded-ctl p-3 space-y-0.5">
                      {lines.slice().reverse().map((l, i) => (
                        <li key={`${l.at}-${i}`} className="text-xs text-ink-600">
                          <span className="text-ink-400 tabular-nums">{formatDateTimeET(l.at)}</span> {l.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
