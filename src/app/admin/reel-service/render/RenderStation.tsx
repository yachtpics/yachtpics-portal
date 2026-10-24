"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { REEL_STYLES, type StyleKey } from "@/lib/reelStyles";
import { ANGLE_LABEL, type ReelServiceAngle, type ReelServiceSettings } from "@/lib/reelService";
import ReelServiceRenderer, { type RenderOutcome } from "../ReelServiceRenderer";
import { LEASE_REFRESH_MS, ago, clearLease, leaseFresh, readLease, writeLease, type StationLease } from "../stationLease";

/** A planned job, as GET /api/admin/reel-service?planned=1 returns it. */
type StationJob = {
  id: string; broker_id: string; listing_id: string; period: string; slot: number; angle: string; look: string;
  settings: ReelServiceSettings | null; status: string; created_at: string;
  listings: { vessel_name: string | null; year: number | null; make: string | null; model: string | null } | null;
};
type Result = { key: string; title: string; look: string; ok: boolean; seconds: number; note: string };

const POLL_MS = 60_000;

function boatName(j: StationJob) {
  const l = j.listings;
  return l?.vessel_name || [l?.year, l?.make, l?.model].filter(Boolean).join(" ") || "Listing";
}
function jobTitle(j: StationJob) {
  return `${boatName(j)} — ${ANGLE_LABEL[j.angle as ReelServiceAngle] ?? j.angle} (slot ${j.slot})`;
}
function lookName(j: StationJob) {
  return REEL_STYLES[j.look as StyleKey]?.name ?? j.look;
}

type WakeSentinel = { release: () => Promise<void> };
type WakeNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeSentinel> } };

/**
 * The render station: polls the planned reels of this month and last every
 * minute while running, and renders them one at a time with the board's own
 * <ReelServiceRenderer> (same output, same `rendering`/`rendered`/`failed`
 * marks). Each job is claimed first (`rendering` with claim: a 409 means
 * another tab or the board has it, so it's skipped). A job that fails is
 * tried once more at the end of the queue, once per station session.
 * One station per browser via a localStorage lease (stationLease.ts).
 */
export default function RenderStation({ auto }: { auto: boolean }) {
  const idRef = useRef("");
  const sinceRef = useRef(0);
  const [running, setRunning] = useState(false);
  /** Another station's lease, when it holds this browser's station. */
  const [blocked, setBlocked] = useState<StationLease | null>(null);
  const [pending, setPending] = useState<StationJob[]>([]);
  const [retries, setRetries] = useState<StationJob[]>([]);
  const [current, setCurrent] = useState<{ job: StationJob; started: number } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [progress, setProgress] = useState<{ text: string; pct: number }>({ text: "Starting", pct: 0 });
  const [results, setResults] = useState<Result[]>([]);
  const [skips, setSkips] = useState<string[]>([]);
  const [batchDone, setBatchDone] = useState(0);
  const [lastPoll, setLastPoll] = useState<number | null>(null);
  const [pollError, setPollError] = useState("");
  const [awake, setAwake] = useState<"yes" | "no" | "unsupported" | null>(null);
  const [now, setNow] = useState(0);
  const attempts = useRef<Record<string, number>>({});

  const runningRef = useRef(running);
  runningRef.current = running;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  const mine = useCallback((): StationLease => ({ id: idRef.current, at: Date.now(), since: sinceRef.current, running: runningRef.current }), []);

  // ── Lease: claim on open, refresh every 10 s, notice a take-over. ──────────
  useEffect(() => {
    if (!idRef.current) {
      idRef.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sinceRef.current = Date.now();
    }
    setNow(Date.now());
    const other = readLease();
    if (leaseFresh(other) && other.id !== idRef.current) {
      setBlocked(other);
    } else {
      writeLease(mine());
      if (auto) setRunning(true);
    }
    function check() {
      const t = Date.now();
      setNow(t);
      const l = readLease();
      if (blockedRef.current) {
        if (leaseFresh(l, t) && l.id !== idRef.current) setBlocked(l);
        else {
          // The other station went away: this one takes the lease (and starts, if opened with ?auto=1).
          setBlocked(null);
          writeLease(mine());
          if (auto) setRunning(true);
        }
        return;
      }
      if (leaseFresh(l, t) && l.id !== idRef.current) {
        // Taken over from another tab: stop after the current reel.
        setBlocked(l);
        setRunning(false);
        return;
      }
      writeLease(mine());
    }
    const iv = window.setInterval(check, LEASE_REFRESH_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 5000);
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === "reelStationLease") check(); };
    const onHide = () => clearLease(idRef.current);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(iv);
      window.clearInterval(clock);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onHide);
      clearLease(idRef.current);
    };
  }, [auto, mine]);

  // Keep the lease's running flag current (the board shows it).
  useEffect(() => {
    if (!blocked && idRef.current) writeLease(mine());
  }, [running, blocked, mine]);

  function takeOver() {
    writeLease(mine());
    setBlocked(null);
    setRunning(true);
  }

  // ── Poll: immediately on start, then every minute while running. ───────────
  const poll = useCallback(async () => {
    setPollError("");
    try {
      const res = await fetch("/api/admin/reel-service?planned=1", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? `Couldn’t read the planned reels (${res.status}).`);
      const jobs = ((d.jobs ?? []) as StationJob[]).filter((j) => j.status === "planned");
      setPending(jobs);
      // A failed reel planned again (re-planned on the board) is a fresh job, not a retry.
      setRetries((r) => r.filter((x) => !jobs.some((j) => j.id === x.id)));
      setLastPoll(Date.now());
      setNow(Date.now());
    } catch (e) {
      setPollError(e instanceof Error ? e.message : "Couldn’t read the planned reels.");
    }
  }, []);

  useEffect(() => {
    if (!running) return;
    void poll();
    const iv = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(iv);
  }, [running, poll]);

  // ── One at a time: claim the next job, then mount the renderer for it. ─────
  useEffect(() => {
    if (!running || blocked || current || claiming) return;
    const fresh = pending.find((j) => j.status === "planned");
    const next = fresh ?? retries[0];
    if (!next) {
      if (batchDone !== 0) setBatchDone(0);
      return;
    }
    const retry = !fresh;
    setClaiming(true);
    setPending((p) => p.filter((x) => x.id !== next.id));
    setRetries((r) => r.filter((x) => x.id !== next.id));
    void (async () => {
      // Yield between reels: lets the previous renderer unmount and release its decoders.
      await new Promise((r) => window.setTimeout(r, 300));
      try {
        const res = await fetch(`/api/admin/reel-service/jobs/${next.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rendering", claim: true, retry }),
        });
        if (res.ok) {
          attempts.current[next.id] = (attempts.current[next.id] ?? 0) + 1;
          setProgress({ text: "Starting", pct: 0 });
          setCurrent({ job: next, started: Date.now() });
        } else {
          const d = await res.json().catch(() => ({}));
          setSkips((s) => [`${jobTitle(next)}: skipped — ${d?.error ?? `taken elsewhere (${res.status})`}`, ...s].slice(0, 20));
        }
      } catch (e) {
        setSkips((s) => [`${jobTitle(next)}: skipped — ${e instanceof Error ? e.message : "network error"}`, ...s].slice(0, 20));
      } finally {
        setClaiming(false);
      }
    })();
  }, [running, blocked, current, claiming, pending, retries, batchDone]);

  function onFinished(job: StationJob, started: number, o: RenderOutcome) {
    const seconds = Math.round((Date.now() - started) / 1000);
    setResults((r) => [{
      key: `${job.id}-${attempts.current[job.id] ?? 1}`,
      title: jobTitle(job),
      look: lookName(job),
      ok: o.ok,
      seconds,
      note: o.ok ? o.note : o.error,
    }, ...r].slice(0, 200));
    if (!o.ok && (attempts.current[job.id] ?? 0) < 2) setRetries((r) => (r.some((x) => x.id === job.id) ? r : [...r, job]));
    setBatchDone((n) => n + 1);
    setCurrent(null);
  }

  // ── Keep the screen awake while running. ───────────────────────────────────
  useEffect(() => {
    if (!running) { setAwake(null); return; }
    const nav = navigator as WakeNavigator;
    if (!nav.wakeLock) { setAwake("unsupported"); return; }
    let lock: WakeSentinel | null = null;
    let cancelled = false;
    async function acquire() {
      if (document.visibilityState !== "visible" || !nav.wakeLock) return;
      try {
        const l = await nav.wakeLock.request("screen");
        if (cancelled) { void l.release().catch(() => {}); return; }
        lock = l;
        setAwake("yes");
      } catch {
        setAwake("no");
      }
    }
    // The browser drops the lock whenever the tab is hidden: take it again on return.
    const onVis = () => { if (document.visibilityState === "visible") void acquire(); };
    void acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      if (lock) void lock.release().catch(() => {});
    };
  }, [running]);

  // Warn before closing the tab mid-reel.
  useEffect(() => {
    if (!current) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [current]);

  const waiting = pending.length + retries.length;
  const made = results.filter((r) => r.ok).length;
  const failed = results.length - made;

  let status: string;
  if (blocked) status = "Another render station is already running";
  else if (current) {
    const t = jobTitle(current.job);
    status = running ? `Rendering ${batchDone + 1} of ${batchDone + 1 + waiting}: ${t}` : `Pausing after this one — rendering ${t}`;
  } else if (!running) status = "Paused";
  else if (claiming) status = "Starting the next reel…";
  else if (lastPoll === null) status = "Checking for planned reels…";
  else status = "Idle — nothing planned";

  return (
    <div className="mt-6">
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
        <p className="text-h2 text-ink-900">{status}</p>
        {blocked && (
          <p className="text-sm text-ink-500 mt-1">
            Opened {blocked.since ? `${ago(now - blocked.since)} ago` : "earlier"}, last seen {ago(now - blocked.at)} ago{blocked.running === false ? " (paused)" : ""}.
            {" "}Only one tab renders, so two never make the same reel.
          </p>
        )}
        {current && (
          <p className="text-sm text-ink-500 mt-1 tabular-nums">{lookName(current.job)} &middot; {progress.text} &middot; {progress.pct}%</p>
        )}
        {!blocked && !current && running && lastPoll !== null && (
          <p className="text-sm text-ink-500 mt-1">Checked {ago(now - lastPoll)} ago &middot; checks again every minute.</p>
        )}
        {pollError && <p className="text-sm text-danger-700 mt-1">{pollError}</p>}

        <div className="mt-5 flex items-center gap-3 flex-wrap">
          {blocked ? (
            <button onClick={takeOver}
              className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl">
              Take over
            </button>
          ) : (
            <>
              <button onClick={() => setRunning((r) => !r)}
                className={running
                  ? "text-sm font-semibold px-4 py-2 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400"
                  : "bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl"}>
                {running ? "Pause" : "Start"}
              </button>
              <button onClick={() => { if (!running) setRunning(true); else void poll(); }}
                title="Look for planned reels now instead of waiting for the next check"
                className="text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400">
                Render now
              </button>
            </>
          )}
          <p className="text-sm text-ink-500 tabular-nums">
            {made} made &middot; {failed} failed &middot; {waiting} waiting
          </p>
        </div>

        <p className="text-xs text-ink-400 mt-5">
          Keep this tab open, in front, and the computer awake; closing it pauses rendering. Reels also render when the board&rsquo;s Make buttons are used.
          {awake === "yes" && " Screen kept awake while running."}
          {(awake === "no" || awake === "unsupported") && " This browser can’t keep the screen awake — set the computer not to sleep."}
        </p>
      </div>

      {current && (
        <div className="mt-4 w-[135px]">
          <ReelServiceRenderer
            key={`${current.job.id}-${attempts.current[current.job.id] ?? 1}`}
            job={current.job}
            onProgress={(text, pct) => setProgress({ text, pct })}
            onFinished={(o) => onFinished(current.job, current.started, o)}
          />
        </div>
      )}

      {(results.length > 0 || skips.length > 0) && (
        <div className="mt-6 bg-white border border-hairline rounded-card shadow-elev-1">
          <p className="px-5 py-3 border-b border-hairline text-sm font-semibold text-ink-900">This session</p>
          <ul className="divide-y divide-hairline">
            {results.map((r) => (
              <li key={r.key} className="px-5 py-2.5 text-sm flex items-start gap-3">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${r.ok ? "bg-success-50 text-success-700" : "bg-danger-50 text-danger-700"}`}>
                  {r.ok ? "ok" : "failed"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-ink-900">{r.title} &middot; <span className="text-ink-500">{r.look}</span></p>
                  {r.note && <p className={`text-xs mt-0.5 ${r.ok ? "text-ink-500" : "text-danger-700"}`}>{r.note}</p>}
                </div>
                <span className="text-xs text-ink-500 tabular-nums shrink-0">{r.seconds} s</span>
              </li>
            ))}
          </ul>
          {skips.length > 0 && (
            <ul className="px-5 py-3 border-t border-hairline text-xs text-ink-400 space-y-1">
              {skips.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
