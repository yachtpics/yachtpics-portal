"use client";

import { useRef, type ReactNode } from "react";

export interface StackVideo {
  /** Stable key (the video id). */
  key: string;
  url: string;
  posterUrl?: string | null;
  /** Shown under the player — the video's title, or its filename. */
  label: string;
}

/** "walkthrough_final.mp4" → "walkthrough final" — a filename read as a caption. */
export function videoLabel(title: string | null | undefined, filename: string | null | undefined): string {
  const t = title?.trim();
  if (t) return t;
  const f = filename?.trim();
  if (!f) return "Video";
  return f.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_]+/g, " ").trim() || "Video";
}

/**
 * The Video tab on buyer pages (/s and /g): the listing's videos stacked one
 * per row, centred at ~960px on desktop. Only one plays at a time — starting
 * one pauses the rest. Links are the self-refreshing signed URLs the viewer
 * already keeps fresh; onError lets it re-sign them.
 */
export default function VideoStack({
  videos,
  onPlay,
  onError,
  extra,
}: {
  videos: StackVideo[];
  onPlay?: (key: string) => void;
  onError?: () => void;
  /** Optional control beside each caption (e.g. a download button). */
  extra?: (video: StackVideo, index: number) => ReactNode;
}) {
  const refs = useRef<Record<string, HTMLVideoElement | null>>({});

  function handlePlay(key: string) {
    Object.keys(refs.current).forEach((k) => {
      const el = refs.current[k];
      if (k !== key && el && !el.paused) el.pause();
    });
    onPlay?.(key);
  }

  return (
    <div className="flex-1 px-3 sm:px-5 py-4 sm:py-6 overflow-auto">
      <div className="mx-auto w-full max-w-[960px] space-y-6 sm:space-y-8">
        {videos.map((v, i) => (
          <figure key={v.key}>
            <div className="overflow-hidden rounded-[2px] bg-ink-950 shadow-print">
              <video
                ref={(el) => { refs.current[v.key] = el; }}
                src={v.url}
                poster={v.posterUrl ?? undefined}
                controls
                playsInline
                preload="metadata"
                onError={onError}
                onPlay={() => handlePlay(v.key)}
                className="block w-full h-auto max-h-[80vh] bg-ink-950"
              />
            </div>
            <figcaption className="mt-2 flex items-center justify-between gap-3">
              <span className="label-caps text-ink-600 truncate">{v.label}</span>
              {extra?.(v, i)}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
