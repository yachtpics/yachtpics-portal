"use client";

import { useEffect, useState } from "react";
import { canShareFiles, isTouchDevice, saveBlob } from "@/lib/photoSave";

export type DeliveredReel = {
  id: string; boat: string; angle: string; caption: string; deliveredAt: string | null;
  playUrl: string | null; brokerName: string | null;
};

async function freshLinks(id: string): Promise<{ url: string; downloadUrl: string; filename: string }> {
  const res = await fetch(`/api/reel-service/jobs/${id}/url`, { cache: "no-store" });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.url) throw new Error(d?.error ?? "Couldn’t get a link to this reel.");
  return d;
}

function ReelCard({ reel }: { reel: DeliveredReel }) {
  const [state, setState] = useState<"" | "working" | "ready">("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  // Read after mount so the server's markup and the browser's agree.
  const [touch, setTouch] = useState(false);
  useEffect(() => { setTouch(isTouchDevice()); }, []);

  /** Desktop (or a phone that can't share files): a plain download. */
  async function download() {
    setErr("");
    try {
      const l = await freshLinks(reel.id);
      const a = document.createElement("a");
      a.href = l.downloadUrl;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed.");
    }
  }

  /**
   * Phone: fetch the MP4 first, then a second tap opens the share sheet (iOS
   * only opens it from a fresh tap, and the fetch uses up the first one —
   * same pattern as the photo Save / share on the listing page).
   */
  async function prepareShare() {
    setErr("");
    setState("working");
    try {
      const l = await freshLinks(reel.id);
      const res = await fetch(l.url);
      if (!res.ok) throw new Error(`Couldn’t fetch the reel (${res.status}).`);
      const blob = await res.blob();
      const f = new File([blob], l.filename, { type: "video/mp4" });
      if (!canShareFiles([f])) {
        saveBlob(blob, l.filename);
        setState("");
        return;
      }
      setFile(f);
      setState("ready");
    } catch (e) {
      setState("");
      setErr(e instanceof Error ? e.message : "Couldn’t get the reel.");
    }
  }

  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file] } as ShareData);
      setState("");
      setFile(null);
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      if (name !== "AbortError") { saveBlob(file, file.name); setState(""); setFile(null); }
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(reel.caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr("Couldn’t copy — select the caption and copy it by hand.");
    }
  }

  return (
    <li id={`reel-${reel.id}`} className="bg-white border border-hairline rounded-card shadow-elev-1 p-4 flex gap-4 flex-col sm:flex-row">
      <div className="sm:w-[200px] shrink-0 flex justify-center">
        {reel.playUrl ? (
          <video src={reel.playUrl} controls playsInline muted preload="metadata" className="rounded-sm bg-ink-950 w-full max-w-[200px]" style={{ aspectRatio: "9 / 16" }} />
        ) : (
          <div className="w-full max-w-[200px] bg-ink-100 rounded-sm flex items-center justify-center text-xs text-ink-400" style={{ aspectRatio: "9 / 16" }}>Preview unavailable</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-900">{reel.boat}</p>
        <p className="text-xs text-ink-500 mt-0.5">
          {reel.angle}
          {reel.brokerName ? ` · ${reel.brokerName}` : ""}
          {reel.deliveredAt ? ` · ${new Date(reel.deliveredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}` : ""}
        </p>
        <div className="flex gap-2 flex-wrap mt-3">
          {touch && state !== "ready" && (
            <button onClick={() => void prepareShare()} disabled={state === "working"}
              className="bg-accent-500 hover:bg-accent-400 disabled:opacity-40 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl">
              {state === "working" ? "Getting the reel…" : "Save or share"}
            </button>
          )}
          {touch && state === "ready" && (
            <button onClick={() => void share()} className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl">
              Reel ready &mdash; tap to save or share
            </button>
          )}
          <button onClick={() => void download()}
            className={touch ? "text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong text-ink-700" : "bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl"}>
            Download
          </button>
        </div>
        {reel.caption && (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className="label-caps text-ink-500">Caption</p>
              <button onClick={() => void copy()} className="text-xs font-semibold text-accent-700 hover:underline">{copied ? "Copied" : "Copy"}</button>
            </div>
            <p className="mt-1 text-sm text-ink-700 whitespace-pre-line bg-ink-50 rounded-ctl p-3 select-all">{reel.caption}</p>
          </div>
        )}
        {err && <p className="mt-3 text-xs text-danger-700">{err}</p>}
      </div>
    </li>
  );
}

export default function ReelList({ reels }: { reels: DeliveredReel[] }) {
  if (reels.length === 0) {
    return <p className="mt-8 text-sm text-ink-500">No reels delivered yet. They&rsquo;ll appear here, newest first, as soon as they&rsquo;re ready.</p>;
  }
  return (
    <ul className="mt-6 space-y-4">
      {reels.map((r) => <ReelCard key={r.id} reel={r} />)}
    </ul>
  );
}
