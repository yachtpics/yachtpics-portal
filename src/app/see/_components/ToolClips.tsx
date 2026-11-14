"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { POSTER_HEIGHT, POSTER_WIDTH, posterSrc, videoSrc, type SeeTool } from "./seeVideos";

type Mode = "tease" | "walk";

const FOCUSABLE = 'button:not([disabled]), a[href], video[controls], [tabindex]:not([tabindex="-1"])';

function PlayGlyph({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M7 4.5v15a.75.75 0 0 0 1.13.65l12.5-7.5a.75.75 0 0 0 0-1.3L8.13 3.85A.75.75 0 0 0 7 4.5Z" />
    </svg>
  );
}

/**
 * Seven tool tiles. A tile opens a lightbox that plays the tool's quick look
 * at once (the tap lets it play with sound), with a button for the full
 * walkthrough and "Request access".
 *
 * The lightbox stays mounted (hidden) so the tap handler itself can set the
 * video's source and call play() — some phones only allow sound when play()
 * runs inside the tap. Nothing loads before a tile is pressed, and the
 * source is released when the lightbox closes.
 */
export default function ToolClips({ tools }: { tools: SeeTool[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("tease");
  const [ended, setEnded] = useState(false);
  const [shown, setShown] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const returnTo = useRef<number | null>(null);

  const tool = open === null ? null : tools[open];

  function playFile(file: string) {
    const v = videoRef.current;
    if (!v) return;
    v.poster = posterSrc(file);
    v.src = videoSrc(file);
    v.play().catch(() => { /* refused — the controls are showing, a tap plays */ });
  }

  function openTool(i: number) {
    returnTo.current = i;
    setMode("tease");
    setEnded(false);
    setOpen(i);
    playFile(tools[i].teaseFile);
  }

  function swap() {
    if (!tool) return;
    const next: Mode = mode === "tease" ? "walk" : "tease";
    setMode(next);
    setEnded(false);
    playFile(next === "walk" ? tool.walkFile : tool.teaseFile);
  }

  const close = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.removeAttribute("src");
      v.removeAttribute("poster");
      v.load(); // drops the buffered video
    }
    setOpen(null);
    setShown(false);
    setEnded(false);
    const i = returnTo.current;
    if (i !== null) tileRefs.current[i]?.focus();
  }, []);

  const isOpen = open !== null;

  // While open: lock page scroll, close on Esc, move focus in, fade in.
  useEffect(() => {
    if (!isOpen) return;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    const bar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (bar > 0) body.style.paddingRight = `${bar}px`;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    const raf = window.requestAnimationFrame(() => setShown(true));
    return () => {
      document.removeEventListener("keydown", onKey);
      window.cancelAnimationFrame(raf);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
    };
  }, [isOpen, close]);

  // Keep Tab inside the lightbox.
  function onDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.prototype.slice.call(dialogRef.current.querySelectorAll(FOCUSABLE)) as HTMLElement[];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const primaryLabel = mode === "tease" && tool ? `Watch the full walkthrough · ${tool.walkDuration}` : "Watch the quick look again";

  return (
    <>
      <ul
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 sm:-mx-8 sm:px-8 scroll-px-4 sm:scroll-px-8 pb-3 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.15)_transparent] lg:grid lg:grid-cols-7 lg:gap-4 lg:overflow-visible lg:mx-0 lg:px-0 lg:pb-0"
        aria-label="Tools in the Portal"
      >
        {tools.map((t, i) => (
          <li key={t.key} className="snap-start shrink-0 w-[42%] sm:w-[27%] md:w-[21%] lg:w-auto min-w-0">
            <button
              type="button"
              ref={(el) => { tileRefs.current[i] = el; }}
              onClick={() => openTool(i)}
              aria-haspopup="dialog"
              aria-label={`${t.name}: ${t.line} Play the quick look.`}
              className="group block w-full text-left rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-950"
            >
              <span className="relative block aspect-[9/16] w-full overflow-hidden rounded-card bg-ink-900 border border-hairline-inverse-soft">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={posterSrc(t.teaseFile)}
                  alt=""
                  width={POSTER_WIDTH}
                  height={POSTER_HEIGHT}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-slow ease-quiet group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:transform-none"
                />
                <span className="absolute bottom-3 left-3 inline-flex items-center justify-center h-8 w-8 rounded-full bg-ink-950/60 backdrop-blur-sm border border-white/25 text-white group-hover:border-accent-300 group-hover:text-accent-200 transition-colors duration-base ease-quiet">
                  <PlayGlyph className="h-3.5 w-3.5 translate-x-[1px]" />
                </span>
              </span>
              <span className="mt-3 block text-white text-sm font-medium leading-snug">{t.name}</span>
              <span className="mt-1 block text-ink-400 text-[0.8125rem] leading-snug">{t.line}</span>
            </button>
          </li>
        ))}
      </ul>

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="see-tool-title"
        aria-hidden={isOpen ? undefined : true}
        onKeyDown={onDialogKeyDown}
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        className={`${isOpen ? "flex" : "hidden"} fixed inset-0 z-[60] items-center justify-center overflow-y-auto bg-ink-950/90 backdrop-blur-sm px-4 py-4 sm:py-6 transition-opacity duration-slow ease-quiet motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`}
      >
        <div
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
          className="w-full max-w-sm sm:max-w-md flex flex-col items-center [--chrome:12.5rem] sm:[--chrome:10rem]"
        >
          <div className="w-full flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h2 id="see-tool-title" className="text-white text-h2 truncate">{tool?.name ?? ""}</h2>
              <p className="label-caps-inverse mt-1">{mode === "tease" ? "Quick look" : `Full walkthrough · ${tool?.walkDuration ?? ""}`}</p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mr-2 shrink-0 inline-flex items-center justify-center h-11 w-11 rounded-full text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          <div className="relative aspect-[9/16] w-[min(100%,calc((100vh_-_var(--chrome))*0.5625))] supports-[height:100dvh]:w-[min(100%,calc((100dvh_-_var(--chrome))*0.5625))] overflow-hidden rounded-card bg-ink-900 border border-hairline-inverse-soft">
            <video
              ref={videoRef}
              controls
              playsInline
              preload="none"
              aria-label={tool ? `${tool.name}, ${mode === "tease" ? "quick look" : "full walkthrough"}` : undefined}
              onEnded={() => setEnded(true)}
              onPlay={() => setEnded(false)}
              className="absolute inset-0 h-full w-full object-contain bg-ink-950"
            />
          </div>

          <div
            className={`w-full mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-center gap-2 sm:gap-6 transition-opacity duration-slow ease-quiet motion-reduce:transition-none ${ended ? "opacity-100" : "opacity-80 hover:opacity-100 focus-within:opacity-100"}`}
          >
            <button
              type="button"
              onClick={swap}
              className={`min-h-[44px] px-5 py-2.5 inline-flex items-center justify-center gap-2 rounded-ctl bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold transition-[background-color,box-shadow] duration-base ease-quiet motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 ${ended ? "ring-2 ring-accent-300/50 ring-offset-2 ring-offset-ink-950" : ""}`}
            >
              <PlayGlyph className="h-3.5 w-3.5 shrink-0" />
              <span className="tabular-nums">{primaryLabel}</span>
            </button>
            <Link
              href="/auth/signup"
              className={`min-h-[44px] inline-flex items-center justify-center text-sm transition-colors duration-fast rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 ${ended ? "text-accent-200 hover:text-white" : "text-accent-300 hover:text-accent-200"}`}
            >
              Request access →
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
