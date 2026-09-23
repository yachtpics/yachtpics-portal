"use client";

import { useEffect, useRef, useState } from "react";
import {
  CLIP_LENGTHS, CLIP_DEFAULT_LENGTH, probeClip,
  type ClipLength, type ClipSource,
} from "@/lib/reelClips";

/**
 * The clip trimmer: choose the few seconds of a video that go in the reel.
 *
 * A muted preview, a slider for where the clip starts, 2s / 3s / 4s, and a
 * "Play clip" that loops exactly the chosen seconds. "Add to reel" first
 * proves the browser can decode the video at that point (probeClip) — a clip
 * that can't be read is turned away here, with the reason, rather than
 * failing a render later.
 */
export default function ReelClipTrimmer({
  title, source, previewSrc, onAdd, onCancel,
}: {
  title: string;
  source: ClipSource;
  /** What the <video> element plays: the signed URL, or an object URL for a local file. */
  previewSrc: string;
  onAdd: (clip: { inSec: number; lengthSec: ClipLength; durationSec: number | null; posterUrl: string | null }) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [inSec, setInSec] = useState(0);
  const [lengthSec, setLengthSec] = useState<ClipLength>(CLIP_DEFAULT_LENGTH);
  const [playing, setPlaying] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState(false);

  // The latest segment, read by the timeupdate loop without re-binding it.
  const seg = useRef({ inSec: 0, lengthSec: CLIP_DEFAULT_LENGTH as number });
  seg.current = { inSec, lengthSec };

  const maxIn = Math.max(0, (duration ?? 0) - lengthSec);
  const tooShort = duration !== null && duration < CLIP_LENGTHS[0];

  // A new length can push the in-point past the end — pull it back.
  useEffect(() => {
    if (duration !== null && inSec > maxIn) setInSec(maxIn);
  }, [duration, maxIn, inSec]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      const { inSec: a, lengthSec: len } = seg.current;
      if (v.currentTime >= a + len || v.currentTime < a - 0.25) v.currentTime = a;
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, []);

  function seek(t: number) {
    setInSec(t);
    setError("");
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); }
    try { v.currentTime = t; } catch { /* not seekable yet */ }
  }

  async function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); return; }
    try {
      v.currentTime = inSec;
      await v.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  async function add() {
    setProbing(true);
    setError("");
    videoRef.current?.pause();
    setPlaying(false);
    try {
      const r = await probeClip(source, inSec);
      onAdd({ inSec, lengthSec, durationSec: r.durationSec ?? duration, posterUrl: r.posterUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "This clip couldn’t be read.");
    } finally {
      setProbing(false);
    }
  }

  const chip = (active: boolean) =>
    `text-xs font-medium px-3 py-1.5 rounded-ctl border transition-colors ${active ? "bg-accent-500 text-ink-950 border-accent-500" : "bg-white text-ink-600 border-hairline-strong hover:border-ink-300"} disabled:opacity-40`;

  return (
    <div className="mt-3 rounded-card border border-hairline-strong bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-semibold text-ink-900 truncate">{title}</p>
        <button onClick={onCancel} disabled={probing} className="text-xs font-semibold text-ink-400 hover:underline shrink-0">Cancel</button>
      </div>
      <div className="flex justify-center bg-ink-950 rounded-sm overflow-hidden">
        <video
          ref={videoRef}
          src={previewSrc}
          // Fetch the preview as a CORS request too. Without this the browser
          // caches R2's reply WITHOUT the CORS headers, and the clip reader's
          // fetch of the same URL a moment later is served that cached copy
          // and blocked — "can't be read by the browser" until a hard reload
          // (Sept 23). Harmless for local blob: URLs.
          crossOrigin="anonymous"
          muted
          playsInline
          preload="auto"
          className="max-h-72 w-auto max-w-full"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            setDuration(Number.isFinite(d) ? d : null);
          }}
          onError={() => setPreviewError(true)}
        />
      </div>
      {previewError && (
        <p className="mt-2 text-xs text-warn-700">This browser can&rsquo;t preview this video. You can still try &ldquo;Add to reel&rdquo; &mdash; it checks whether the clip can be used.</p>
      )}

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-ink-500 mb-1">
          <span>Starts at {inSec.toFixed(1)}s</span>
          <span>{duration !== null ? `of ${duration.toFixed(1)}s` : ""}</span>
        </div>
        <input
          type="range"
          min={0}
          max={maxIn || 0}
          step={0.05}
          value={Math.min(inSec, maxIn)}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={probing || duration === null || maxIn <= 0}
          className="w-full accent-accent-500"
          aria-label="Where the clip starts"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {CLIP_LENGTHS.map((len) => (
          <button
            key={len}
            onClick={() => { setLengthSec(len); setError(""); }}
            disabled={probing || (duration !== null && duration < len)}
            className={chip(lengthSec === len)}
          >
            {len}s
          </button>
        ))}
        <button onClick={togglePlay} disabled={probing || previewError} className={chip(false)}>
          {playing ? "Pause" : "Play clip"}
        </button>
        <button
          onClick={add}
          disabled={probing || tooShort}
          className="ml-auto bg-accent-500 hover:bg-accent-400 disabled:opacity-40 text-ink-950 text-xs font-semibold px-4 py-2 rounded-ctl transition-colors"
        >
          {probing ? "Checking the clip…" : "Add to reel"}
        </button>
      </div>
      {tooShort && <p className="mt-2 text-xs text-ink-500">This video is shorter than two seconds &mdash; too short for a clip.</p>}
      {error && <p className="mt-2 text-xs text-danger-700">{error}</p>}
      <p className="mt-2 text-xs text-ink-400">Clips are silent in the reel. Drag the slider to choose where it starts; &ldquo;Play clip&rdquo; loops just those seconds.</p>
    </div>
  );
}
