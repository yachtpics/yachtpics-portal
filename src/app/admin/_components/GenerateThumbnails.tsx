"use client";

import { useEffect, useRef, useState } from "react";
import JobProgress, { fetchActiveJob, startJob } from "@/components/admin/JobProgress";
import type { JobRow } from "@/lib/jobs/types";

type Phase = "idle" | "running" | "done" | "stopped";

/**
 * Backfills the stored photo thumbnails (600 / 2000 px WebP copies) for every
 * photo that doesn't have them yet. Runs as a server background job
 * (`derivatives_backfill`, src/lib/jobs/), so closing the tab doesn't stop it;
 * Cancel on the progress card does. Until the jobs table exists it falls back
 * to the old in-tab loop: /api/admin/derivatives/run over and over (each call
 * ~45 s) — Stop or closing the tab pauses that. The daily cron chips away at
 * whatever is left either way.
 */
export default function GenerateThumbnails({ initialRemaining }: { initialRemaining: number }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [remaining, setRemaining] = useState(initialRemaining);
  const [made, setMade] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [failed, setFailed] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [startTotal, setStartTotal] = useState(initialRemaining);
  const stopRef = useRef(false);
  const [job, setJob] = useState<JobRow | null>(null);
  const [starting, setStarting] = useState(false);
  const jobActive = !!job && (job.status === "queued" || job.status === "running");

  // A backfill started earlier (maybe from another tab) is still going: show it.
  useEffect(() => {
    fetchActiveJob("derivatives_backfill").then((j) => { if (j) setJob(j); });
  }, []);

  async function refreshRemaining() {
    try {
      const res = await fetch("/api/admin/derivatives/run", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.remaining === "number") setRemaining(data.remaining);
    } catch {
      // Leave the old number.
    }
  }

  async function run() {
    if (phase === "running" || starting || jobActive) return;
    setNote(null);
    setStarting(true);
    const r = await startJob("derivatives_backfill");
    setStarting(false);
    if (r.job) {
      setPhase("idle");
      setJob(r.job);
      return;
    }
    if (!r.notReady) {
      setNote(r.error);
      return;
    }
    await runInTab("Background jobs aren't set up yet, so this runs in this tab — keep it open while it works.");
  }

  async function runInTab(firstNote: string | null = null) {
    if (phase === "running") return;
    stopRef.current = false;
    setPhase("running");
    setNote(firstNote);
    setMade(0);
    setSkipped(0);
    setFailed(0);
    setStartTotal(remaining);

    let errorsInARow = 0;
    let lastRemaining = remaining;
    for (;;) {
      if (stopRef.current) {
        setPhase("stopped");
        return;
      }
      try {
        const res = await fetch("/api/admin/derivatives/run", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `The server answered ${res.status}`);
        errorsInARow = 0;
        setMade((n) => n + (data.done ?? 0));
        setSkipped((n) => n + (data.unavailable ?? 0));
        setFailed((n) => n + (data.failed ?? 0));
        lastRemaining = Number(data.remaining ?? 0);
        setRemaining(lastRemaining);
        if (Array.isArray(data.sampleErrors) && data.sampleErrors.length) setNote(`Last problem: ${data.sampleErrors[0]}`);
        if (lastRemaining <= 0) break;
        // Nothing moved in a whole call → only stubborn photos are left.
        if ((data.done ?? 0) + (data.unavailable ?? 0) === 0) {
          setNote(`Stopped: ${lastRemaining} photo${lastRemaining === 1 ? "" : "s"} keep failing. ${Array.isArray(data.sampleErrors) && data.sampleErrors[0] ? `(${data.sampleErrors[0]})` : ""} Try again later — the pages still work for these.`);
          setPhase("stopped");
          return;
        }
      } catch (e) {
        errorsInARow++;
        setNote(e instanceof Error ? e.message : "Network error");
        if (errorsInARow >= 3) {
          setPhase("stopped");
          return;
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    setPhase("done");
  }

  const pct = startTotal > 0 ? Math.min(100, Math.round(((startTotal - remaining) / startTotal) * 100)) : 100;

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-ink-900 mb-1">Photo thumbnails</h3>
          <p className="text-ink-500 text-sm">
            Makes the stored small and large copies of each photo, so listing pages and slideshows load
            without resizing on the fly. New uploads get them automatically; this catches up older photos.
            It runs on the server — you can close this tab and come back to check on it.
          </p>
        </div>
        {phase === "running" ? (
          <button
            onClick={() => { stopRef.current = true; }}
            className="shrink-0 bg-white border border-hairline hover:bg-ink-50 text-ink-900 text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={run}
            disabled={remaining <= 0 || starting || jobActive}
            className="shrink-0 bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet whitespace-nowrap"
          >
            {jobActive || starting
              ? "Working…"
              : remaining > 0
                ? `Generate thumbnails (remaining: ${remaining.toLocaleString("en-US")})`
                : "All thumbnails made"}
          </button>
        )}
      </div>

      {job && (
        <div className="mt-4 border-t border-hairline pt-4">
          <JobProgress
            job={job}
            compact
            onFinished={(j) => {
              setJob(j);
              refreshRemaining();
            }}
          />
        </div>
      )}

      {(phase === "running" || phase === "stopped") && (
        <div className="mt-4">
          <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
            <div className="h-full bg-accent-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-ink-500 mt-2 tabular-nums">
            {phase === "running" ? "Working… " : "Paused. "}
            {made.toLocaleString("en-US")} made this session · {remaining.toLocaleString("en-US")} to go
            {skipped > 0 ? ` · ${skipped} can't be resized (they keep the old view)` : ""}
            {failed > 0 ? ` · ${failed} retried later` : ""}
          </p>
        </div>
      )}

      {phase === "done" && (
        <p className="mt-4 text-sm text-success-700">
          Done — {made.toLocaleString("en-US")} photo{made === 1 ? "" : "s"} now have stored thumbnails.
          {skipped > 0 ? ` ${skipped} couldn't be resized and keep the old view.` : ""}
        </p>
      )}

      {note && phase !== "done" && <p className="mt-2 text-xs text-warn-700">{note}</p>}
    </div>
  );
}
