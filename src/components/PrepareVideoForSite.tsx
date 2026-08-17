"use client";

import { useState } from "react";

type Video = { id: string; filename: string | null };

type Phase = "idle" | "working" | "done" | "error";

/**
 * Copies a listing's videos to the public media host, in parts, from the browser.
 *
 * Big video can't be copied inside the publish request: the first real boat had
 * a 1.2GB drone file, which is more memory than a serverless function has and
 * more time than it's given — the request died and returned an HTML error page.
 *
 * So the browser drives it instead. Each request moves one 64MB slice, which
 * takes seconds and a fixed amount of memory whatever the file size. That also
 * means honest progress, and a dropped connection costs one slice rather than
 * the whole file.
 *
 * Publishing then just assembles the page from what's already there.
 */
export default function PrepareVideoForSite({ videos }: { videos: Video[] }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [current, setCurrent] = useState("");
  const [pct, setPct] = useState(0);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");

  async function call(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/media/copy-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // The route always answers JSON. If it doesn't, the function itself fell
    // over — say that plainly rather than letting JSON.parse throw something
    // meaningless about an unexpected "<".
    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("The server stopped responding partway through. Try again — finished parts are kept.");
    }
    if (!res.ok) throw new Error(String(data.error ?? "Something went wrong."));
    return data;
  }

  async function run() {
    if (phase === "working") return;
    setPhase("working");
    setError("");

    try {
      for (let i = 0; i < videos.length; i++) {
        const v = videos[i];
        setIndex(i);
        setCurrent(v.filename ?? "video");
        setPct(0);

        const start = await call({ action: "start", videoId: v.id });

        if (start.alreadyThere) {
          setPct(100);
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
          setPct(Math.round((p / totalParts) * 100));
        }

        await call({ action: "finish", videoId: v.id, uploadId: start.uploadId, parts });
      }

      setPhase("done");
      setCurrent("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't copy the video.");
      setPhase("error");
    }
  }

  if (videos.length === 0) return null;

  return (
    <div className="mt-3 rounded-ctl border border-hairline-strong bg-white px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-800">Prepare video for the website</p>
          <p className="text-xs text-ink-400 mt-0.5">
            Copies {videos.length === 1 ? "the video" : `${videos.length} videos`} to the media host. Do this
            once per video, before publishing.
          </p>
        </div>
        <button
          onClick={run}
          disabled={phase === "working"}
          className="shrink-0 text-xs font-semibold bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-ctl transition-colors duration-fast"
        >
          {phase === "working" ? "Copying…" : phase === "done" ? "Copy again" : "Copy to media host"}
        </button>
      </div>

      {phase === "working" && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-ink-500 mb-1">
            <span className="truncate">
              {videos.length > 1 ? `${index + 1} of ${videos.length} — ` : ""}{current}
            </span>
            <span className="tabular-nums shrink-0">{pct}%</span>
          </div>
          <div className="bg-ink-100 rounded-full h-2">
            <div className="bg-accent-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-ink-400 mt-1.5">
            Large files take a few minutes. Keep this page open — closing it stops the copy, but finished
            parts are kept and it picks up from there.
          </p>
        </div>
      )}

      {phase === "done" && (
        <p className="mt-2 text-xs text-success-700">
          Copied. You can publish this boat to the website now.
        </p>
      )}

      {phase === "error" && (
        <p className="mt-2 text-xs text-danger-700">{error}</p>
      )}
    </div>
  );
}
