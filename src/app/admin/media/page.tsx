"use client";

import { useEffect, useState } from "react";

export const dynamic = "force-dynamic";

type Pending = { id: string; filename: string | null };
type Phase = "idle" | "loading" | "running" | "done" | "error" | "cleaning";

/**
 * The video migration, as one page with two buttons.
 *
 * "Move videos to Cloudflare" copies every remaining video off Supabase in
 * 64MB pieces, verifies each byte-for-byte, and flips its row so the portal
 * serves it from Cloudflare. Nothing is deleted — every file exists in both
 * places afterwards, so this stage is fully reversible.
 *
 * "Free up Supabase space" is the deliberate second step, days later: it
 * deletes the Supabase copies of videos that have been serving from Cloudflare,
 * re-verifying each one immediately before deletion. Kept as a separate button
 * with a confirm because it's the only irreversible part.
 */
export default function MediaMigrationPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [pending, setPending] = useState<Pending[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [current, setCurrent] = useState("");
  const [filePct, setFilePct] = useState(0);
  const [movedThisRun, setMovedThisRun] = useState(0);
  const [failures, setFailures] = useState<string[]>([]);
  const [cleanupResult, setCleanupResult] = useState("");

  async function call(bodyObj: Record<string, unknown>) {
    const res = await fetch("/api/admin/media/migrate-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
    });
    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("The server stopped responding. Run it again — finished work is kept.");
    }
    if (!res.ok) throw new Error(String(data.error ?? "Something went wrong."));
    return data;
  }

  async function refresh() {
    setPhase("loading");
    try {
      const d = await call({ action: "list" });
      setPending((d.pending as Pending[]) ?? []);
      setDoneCount(Number(d.doneCount ?? 0));
      setTotalCount(Number(d.totalCount ?? 0));
      setPhase("idle");
    } catch {
      setPhase("error");
      setFailures(["Couldn't load the video list."]);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    if (phase === "running") return;
    setPhase("running");
    setFailures([]);
    setMovedThisRun(0);

    const queue = [...pending];
    const fails: string[] = [];

    for (const v of queue) {
      setCurrent(v.filename ?? "video");
      setFilePct(0);
      try {
        const start = await call({ action: "start", videoId: v.id });
        if (start.alreadyMigrated) {
          setMovedThisRun((n) => n + 1);
          setPending((prev) => prev.filter((p) => p.id !== v.id));
          setDoneCount((n) => n + 1);
          continue;
        }

        const totalParts = Number(start.totalParts);
        const parts: { PartNumber: number; ETag: string }[] = [];
        for (let p = 1; p <= totalParts; p++) {
          const res = await call({
            action: "part",
            videoId: v.id,
            uploadId: start.uploadId,
            sourceUrl: start.sourceUrl,
            totalBytes: start.totalBytes,
            partNumber: p,
          });
          parts.push(res.part as { PartNumber: number; ETag: string });
          setFilePct(Math.round((p / totalParts) * 100));
        }

        await call({
          action: "finish",
          videoId: v.id,
          uploadId: start.uploadId,
          parts,
          totalBytes: start.totalBytes,
        });

        setMovedThisRun((n) => n + 1);
        setPending((prev) => prev.filter((p) => p.id !== v.id));
        setDoneCount((n) => n + 1);
      } catch (e) {
        // One failure doesn't stop the run — the rest keep moving, and this one
        // stays safely on Supabase for a retry.
        fails.push(`${v.filename ?? v.id} — ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    setCurrent("");
    setFailures(fails);
    setPhase(fails.length && !queue.length ? "error" : "done");
  }

  async function cleanup() {
    if (
      !confirm(
        `Delete the Supabase copies of ${doneCount} migrated video${doneCount !== 1 ? "s" : ""}? ` +
        `Each is re-verified on Cloudflare immediately before deletion. This is the only ` +
        `irreversible step — do it only after the portal has been playing video normally for a few days.`
      )
    )
      return;

    setPhase("cleaning");
    setCleanupResult("");

    // Fetch the migrated set fresh, then delete one Supabase copy at a time —
    // each is re-verified on Cloudflare inside the route before removal.
    let freed = 0;
    let cleaned = 0;
    const fails: string[] = [];
    try {
      const data = await call({ action: "list" });
      const ids = (data.migrated as { id: string; filename: string | null }[]) ?? [];
      for (const v of ids) {
        setCurrent(v.filename ?? "video");
        try {
          const r = await call({ action: "cleanup", videoId: v.id });
          freed += Number(r.freedBytes ?? 0);
          cleaned += 1;
        } catch (e) {
          fails.push(`${v.filename ?? v.id} — ${e instanceof Error ? e.message : "failed"}`);
        }
      }
    } catch (e) {
      fails.push(e instanceof Error ? e.message : "Couldn't list migrated videos.");
    }
    setCurrent("");
    setFailures(fails);
    setCleanupResult(
      `Deleted ${cleaned} Supabase cop${cleaned === 1 ? "y" : "ies"}, freeing ${(freed / 1073741824).toFixed(1)} GB.`
    );
    setPhase("done");
  }

  const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-8 pb-6 border-b border-hairline">
        <h1 className="text-display text-ink-900">Video Migration</h1>
        <p className="text-ink-500 mt-1.5 text-sm">
          Moving the video library from Supabase to Cloudflare. Copy first, verify every byte, and only
          delete from Supabase days later — nothing here is destructive until the final button.
        </p>
      </div>

      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 mb-6">
        <div className="flex items-center justify-between gap-4 mb-3">
          <p className="text-sm font-semibold text-ink-900">
            {doneCount} of {totalCount} videos on Cloudflare
          </p>
          <span className="text-sm text-ink-500 tabular-nums">{pct}%</span>
        </div>
        <div className="bg-ink-100 rounded-full h-2.5 mb-5">
          <div className="bg-accent-500 h-2.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>

        {phase === "running" && (
          <div className="mb-5">
            <div className="flex justify-between text-xs text-ink-500 mb-1">
              <span className="truncate">Moving {current}…</span>
              <span className="tabular-nums shrink-0">{filePct}%</span>
            </div>
            <div className="bg-ink-100 rounded-full h-2">
              <div className="bg-ink-950 h-2 rounded-full transition-all" style={{ width: `${filePct}%` }} />
            </div>
            <p className="text-xs text-ink-400 mt-1.5">
              Keep this page open. 30&nbsp;GB takes an hour or two; closing the page pauses it, and it
              resumes from where it stopped.
            </p>
          </div>
        )}

        {phase === "cleaning" && (
          <p className="text-sm text-ink-500 mb-4">Deleting Supabase copies… {current}</p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={run}
            disabled={phase === "running" || phase === "loading" || phase === "cleaning" || pending.length === 0}
            className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-5 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            {phase === "running"
              ? "Moving…"
              : pending.length === 0
                ? "All videos moved"
                : `Move ${pending.length} video${pending.length !== 1 ? "s" : ""} to Cloudflare`}
          </button>

          <button
            onClick={cleanup}
            disabled={phase !== "idle" && phase !== "done" ? true : doneCount === 0}
            title="Only after the portal has served video from Cloudflare for a few days"
            className="border border-danger-300 text-danger-700 hover:bg-danger-50 disabled:opacity-40 text-sm font-semibold px-5 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            Free up Supabase space
          </button>
        </div>

        {movedThisRun > 0 && phase === "done" && (
          <p className="mt-4 text-sm text-success-700">
            Moved and verified {movedThisRun} video{movedThisRun !== 1 ? "s" : ""} this run. The portal now
            serves them from Cloudflare; the Supabase copies remain as a safety net until you free the space.
          </p>
        )}

        {cleanupResult && <p className="mt-4 text-sm text-success-700">{cleanupResult}</p>}

        {failures.length > 0 && (
          <div className="mt-4 bg-danger-50 border border-danger-200 rounded-ctl px-4 py-3">
            <p className="text-xs font-semibold text-danger-700 mb-1">
              {failures.length} didn&apos;t complete — safe to run again, they pick up where they stopped:
            </p>
            <ul className="text-xs text-danger-700 space-y-0.5">
              {failures.map((f, i) => <li key={i} className="break-all">{f}</li>)}
            </ul>
          </div>
        )}
      </div>

      <p className="text-xs text-ink-400">
        After moving: use the portal normally for a few days — play a video, download one, open a client
        gallery. When everything behaves, come back and free the Supabase space.
      </p>
    </div>
  );
}
