"use client";

import { useEffect, useRef, useState } from "react";
import { POSTER_HEIGHT, POSTER_WIDTH } from "./seeVideos";
import { attachVideoTracking } from "./trackVideo";

/**
 * The two-minute tour: a poster with a play button. Nothing of the video
 * loads until it is pressed (preload="none"); then it plays with sound and
 * the browser's own controls.
 *
 * `trackKey` (the file name without .mp4) turns on the anonymous play
 * metrics (trackVideo.ts): play, 25 / 50 / 75 %, complete.
 */
export default function TourVideo({ src, poster, duration, label, trackKey }: { src: string; poster: string; duration: string; label: string; trackKey?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v || !trackKey) return;
    return attachVideoTracking(v, () => trackKey);
  }, [trackKey]);

  function start() {
    const v = ref.current;
    if (!v) return;
    setStarted(true);
    v.controls = true;
    // Called inside the tap, so the browser lets it play with sound.
    v.play().catch(() => { /* refused — the controls are showing, a second tap plays */ });
  }

  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-card bg-ink-900 border border-hairline-inverse-soft">
      <video
        ref={ref}
        src={src}
        poster={started ? poster : undefined}
        playsInline
        preload="none"
        aria-label={label}
        className="absolute inset-0 h-full w-full object-contain bg-ink-950"
      />
      {!started && (
        <button
          type="button"
          onClick={start}
          aria-label={`Play ${label}, ${duration}`}
          className="group absolute inset-0 block w-full h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={poster}
            alt=""
            width={POSTER_WIDTH}
            height={POSTER_HEIGHT}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span aria-hidden className="absolute inset-0 bg-ink-950/20 group-hover:bg-ink-950/10 transition-colors duration-base ease-quiet" />
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 inline-flex items-center justify-center h-[4.5rem] w-[4.5rem] rounded-full bg-ink-950/60 backdrop-blur-sm border border-white/30 text-white group-hover:border-accent-300 group-hover:text-accent-200 transition-colors duration-base ease-quiet"
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7 translate-x-[2px]" fill="currentColor"><path d="M7 4.5v15a.75.75 0 0 0 1.13.65l12.5-7.5a.75.75 0 0 0 0-1.3L8.13 3.85A.75.75 0 0 0 7 4.5Z" /></svg>
          </span>
          <span aria-hidden className="absolute bottom-4 left-4 label-caps-inverse text-white/80 bg-ink-950/60 backdrop-blur-sm rounded-ctl px-2.5 py-1.5 tabular-nums">
            {duration}
          </span>
        </button>
      )}
    </div>
  );
}
