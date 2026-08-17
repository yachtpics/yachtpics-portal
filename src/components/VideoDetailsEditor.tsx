"use client";

import { useState } from "react";

/**
 * Names a video and, optionally, describes it.
 *
 * Not every video is a walkthrough — there are drone reels, sea trials, engine
 * room tours, owner interviews. Whoever manages the listing knows which; the
 * page can't guess, and guessing wrong ("Walkthrough Video" over a drone reel)
 * reads as careless on a listing meant to sell a yacht.
 *
 * Collapsed to a single line until clicked, so the video list stays a list.
 */
export default function VideoDetailsEditor({
  videoId,
  title,
  description,
  onSaved,
}: {
  videoId: string;
  title: string | null;
  description: string | null;
  onSaved: (next: { title: string | null; description: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(title ?? "");
  const [d, setD] = useState(description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/videos/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, title: t, description: d }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't save.");
      onSaved({ title: t.trim() || null, description: d.trim() || null });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-left text-ink-500 hover:text-accent-700 transition-colors duration-fast"
      >
        {title
          ? <><span className="font-medium text-ink-800">{title}</span>{description ? <span className="text-ink-400"> — {description}</span> : null}</>
          : <span className="text-ink-400">+ Name this video (shown on the website)</span>}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <input
        value={t}
        onChange={(e) => setT(e.target.value)}
        maxLength={80}
        autoFocus
        placeholder="Aerial Drone Footage"
        className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
      />
      <textarea
        value={d}
        onChange={(e) => setD(e.target.value)}
        maxLength={400}
        rows={2}
        placeholder="Optional — a line about what this video shows."
        className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 resize-none focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
      />
      {error && <p className="text-xs text-danger-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="text-xs font-semibold bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 px-3 py-1.5 rounded-ctl transition-colors duration-fast"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => { setT(title ?? ""); setD(description ?? ""); setOpen(false); setError(""); }}
          disabled={busy}
          className="text-xs text-ink-500 hover:text-ink-800 transition-colors duration-fast"
        >
          Cancel
        </button>
        <span className="text-xs text-ink-400 ml-auto">Appears above the video on yachtpics.com</span>
      </div>
    </div>
  );
}
