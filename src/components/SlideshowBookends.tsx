"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BOOKEND_WIDE_ASPECT, SLIDESHOW_OPEN_CAP_MS, SLIDESHOW_OPEN_MS } from "@/lib/logoBookends";

/**
 * Logo bookends on the buyer slideshow (Nov 25, 2026 — src/lib/logoBookends.ts).
 *
 * <BookendOpener>: the first thing a buyer sees — the broker's (or office's)
 * opening logo centred on its colour, over the whole screen, while the first
 * photograph loads underneath exactly as it always has. It leaves 2 s after
 * the logo has loaded, at the latest 2.6 s after it appeared, at once if the
 * logo can't be loaded, or the moment the buyer taps, clicks, swipes or
 * presses a key. A 400 ms fade out (none under reduced motion).
 *
 * <BookendFrame>: the closing frame, shown as a final slide after the last
 * photograph. It is not a photograph — never counted, saved or reported.
 */

const FADE_MS = 400;

/** Stacked marks: up to 58vmin square. Horizontal: up to 76vw (and 95vh), 58vmin tall. */
function logoStyle(wide: boolean | null): React.CSSProperties {
  if (wide) return { maxWidth: "min(76vw, 95vh)", maxHeight: "58vmin" };
  return { maxWidth: "58vmin", maxHeight: "58vmin" };
}

export function BookendOpener({ ground, src, onDone }: { ground: string; src: string; onDone: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [wide, setWide] = useState<boolean | null>(null);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const leave = useCallback((immediate = false) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (immediate || reduced) { onDone(); return; }
    setLeaving(true);
    window.setTimeout(onDone, FADE_MS);
  }, [onDone]);

  // Hard cap from mount, whatever happens.
  useEffect(() => {
    const t = window.setTimeout(() => leave(), SLIDESHOW_OPEN_CAP_MS);
    return () => window.clearTimeout(t);
  }, [leave]);

  // The logo's own stay starts once it has loaded.
  useEffect(() => {
    if (!loaded) return;
    const t = window.setTimeout(() => leave(), SLIDESHOW_OPEN_MS);
    return () => window.clearTimeout(t);
  }, [loaded, leave]);

  // A logo already in the cache can finish before React attaches onLoad.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete) {
      if (el.naturalWidth > 0) {
        setWide(el.naturalWidth / Math.max(1, el.naturalHeight) >= BOOKEND_WIDE_ASPECT);
        setLoaded(true);
      } else {
        leave(true);
      }
    }
  }, [leave]);

  // Any key skips; the page underneath doesn't scroll while it's up.
  useEffect(() => {
    const onKey = () => leave();
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [leave]);

  return (
    <button
      type="button"
      aria-label="Skip intro"
      onClick={() => leave()}
      onTouchStart={() => leave()}
      className="fixed inset-0 z-[60] flex items-center justify-center w-full h-full cursor-pointer focus:outline-none"
      style={{
        background: ground,
        opacity: leaving ? 0 : 1,
        transition: `opacity ${FADE_MS}ms cubic-bezier(0.25, 0, 0.15, 1)`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt=""
        decoding="async"
        onLoad={(e) => {
          const img = e.currentTarget;
          setWide(img.naturalWidth / Math.max(1, img.naturalHeight) >= BOOKEND_WIDE_ASPECT);
          setLoaded(true);
        }}
        onError={() => leave(true)}
        className="object-contain select-none pointer-events-none"
        style={{ ...logoStyle(wide), opacity: loaded ? 1 : 0, transition: "opacity 300ms ease-out" }}
      />
    </button>
  );
}

/** The closing frame: the closing logo centred on its colour, filling its box. */
export function BookendFrame({ ground, src }: { ground: string; src: string }) {
  const [wide, setWide] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="absolute inset-0 flex items-center justify-center rounded-[2px] overflow-hidden" style={{ background: ground }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        decoding="async"
        onLoad={(e) => {
          const img = e.currentTarget;
          setWide(img.naturalWidth / Math.max(1, img.naturalHeight) >= BOOKEND_WIDE_ASPECT);
          setLoaded(true);
        }}
        className="object-contain select-none pointer-events-none"
        style={{
          maxWidth: wide ? "76%" : "58%",
          maxHeight: "58%",
          opacity: loaded ? 1 : 0,
          transition: "opacity 300ms ease-out",
        }}
      />
    </div>
  );
}
