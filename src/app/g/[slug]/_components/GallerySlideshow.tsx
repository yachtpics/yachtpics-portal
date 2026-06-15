"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Slide = { url: string; category: string | null };

export default function GallerySlideshow({
  slug,
  title,
  slides,
}: {
  slug: string;
  title: string;
  slides: Slide[];
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const logged = useRef(false);

  // Log one view on mount
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    fetch(`/api/g/${slug}/view`, { method: "POST" }).catch(() => {});
  }, [slug]);

  const next = useCallback(() => setIndex((i) => (slides.length ? (i + 1) % slides.length : 0)), [slides.length]);
  const prev = useCallback(() => setIndex((i) => (slides.length ? (i - 1 + slides.length) % slides.length : 0)), [slides.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  useEffect(() => {
    if (!playing || slides.length < 2) return;
    const t = setInterval(next, 4000);
    return () => clearInterval(t);
  }, [playing, next, slides.length]);

  if (slides.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050b14] px-6 text-center">
        <div>
          <p className="text-lg font-semibold text-white mb-1">YachtPics <span className="text-[#d4a843]">Gallery</span></p>
          <p className="text-sm text-gray-400 mt-3">This gallery doesn&apos;t have any photos yet.</p>
        </div>
      </div>
    );
  }

  const current = slides[index];

  return (
    <div className="min-h-screen bg-[#050b14] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-white tracking-wide">
            YachtPics <span className="text-[#d4a843]">Gallery</span>
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{title}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{index + 1} / {slides.length}</span>
          {slides.length > 1 && (
            <button
              onClick={() => setPlaying((p) => !p)}
              className="text-xs font-medium text-[#050b14] bg-[#d4a843] hover:bg-[#c49a35] px-3 py-1.5 rounded-lg transition-colors"
            >
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
          )}
        </div>
      </div>

      {/* Stage */}
      <div className="relative flex-1 flex items-center justify-center px-4 pb-6 select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={current.category ?? "Photo"}
          className="max-h-[80vh] max-w-full object-contain rounded-lg"
        />

        {slides.length > 1 && (
          <>
            <button
              onClick={prev}
              aria-label="Previous"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl flex items-center justify-center transition-colors"
            >
              ‹
            </button>
            <button
              onClick={next}
              aria-label="Next"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl flex items-center justify-center transition-colors"
            >
              ›
            </button>
          </>
        )}

        {current.category && (
          <span className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-3 py-1 rounded-full">
            {current.category}
          </span>
        )}
      </div>
    </div>
  );
}
