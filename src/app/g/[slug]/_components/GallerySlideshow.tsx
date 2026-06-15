"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

type Slide =
  | { type: "photo"; url: string; category: string | null }
  | { type: "video"; url: string; filename: string | null };

export default function GallerySlideshow({
  slug,
  title,
  photos,
  videos,
}: {
  slug: string;
  title: string;
  photos: { url: string; category: string | null }[];
  videos: { url: string; filename: string | null }[];
}) {
  const slides = useMemo<Slide[]>(
    () => [
      ...photos.map((p) => ({ type: "photo" as const, url: p.url, category: p.category })),
      ...videos.map((v) => ({ type: "video" as const, url: v.url, filename: v.filename })),
    ],
    [photos, videos]
  );

  const [view, setView] = useState<"slideshow" | "grid">("slideshow");
  const [current, setCurrent] = useState(0);
  const [outgoing, setOutgoing] = useState<number | null>(null);
  const [incomingReady, setIncomingReady] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const logged = useRef(false);

  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    fetch(`/api/g/${slug}/view`, { method: "POST" }).catch(() => {});
  }, [slug]);

  const goTo = useCallback((i: number) => {
    setCurrent((cur) => {
      if (i === cur) return cur;
      setOutgoing(cur);
      setIncomingReady(false);
      return i;
    });
  }, []);

  const next = useCallback(() => {
    setCurrent((c) => {
      const n = slides.length ? (c + 1) % slides.length : 0;
      if (n !== c) {
        setOutgoing(c);
        setIncomingReady(false);
      }
      return n;
    });
  }, [slides.length]);

  const prev = useCallback(() => {
    setCurrent((c) => {
      const n = slides.length ? (c - 1 + slides.length) % slides.length : 0;
      if (n !== c) {
        setOutgoing(c);
        setIncomingReady(false);
      }
      return n;
    });
  }, [slides.length]);

  // Fade the incoming slide in
  useEffect(() => {
    if (incomingReady) return;
    const id = requestAnimationFrame(() => setIncomingReady(true));
    return () => cancelAnimationFrame(id);
  }, [incomingReady, current]);

  // Drop the outgoing slide once the fade finishes
  useEffect(() => {
    if (incomingReady && outgoing !== null) {
      const t = setTimeout(() => setOutgoing(null), 550);
      return () => clearTimeout(t);
    }
  }, [incomingReady, outgoing]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  useEffect(() => {
    if (!playing || slides.length < 2 || view !== "slideshow") return;
    const t = setInterval(next, 4000);
    return () => clearInterval(t);
  }, [playing, next, slides.length, view]);

  if (slides.length === 0) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6 text-center">
        <div>
          <p className="text-sm font-semibold text-[#d4a843] uppercase tracking-wide">YachtPics</p>
          <p className="text-gray-500 mt-2">This gallery doesn&apos;t have any photos yet.</p>
        </div>
      </div>
    );
  }

  const slide = slides[current];
  const outSlide = outgoing !== null ? slides[outgoing] : null;
  const caption = slide.type === "video" ? "Video" : slide.category ?? "";

  const videoTile = (size: string) => (
    <div className={`${size} bg-gray-900 flex items-center justify-center`}>
      <svg className="w-1/4 h-1/4 text-white" fill="currentColor" viewBox="0 0 20 20">
        <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
      </svg>
    </div>
  );

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-[#d4a843] tracking-wide uppercase">YachtPics</p>
          <h1 className="text-gray-900 font-semibold text-base sm:text-lg truncate">{title}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {slides.length > 1 && view === "slideshow" && (
            <button
              onClick={() => setPlaying((p) => !p)}
              className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-200 text-gray-600 hover:text-gray-900 transition-colors"
            >
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
          )}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setView("slideshow")}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors font-medium ${view === "slideshow" ? "bg-[#d4a843] text-white" : "text-gray-500 hover:text-gray-900"}`}
            >
              Slideshow
            </button>
            <button
              onClick={() => setView("grid")}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors font-medium ${view === "grid" ? "bg-[#d4a843] text-white" : "text-gray-500 hover:text-gray-900"}`}
            >
              All Photos
            </button>
          </div>
        </div>
      </div>

      {view === "slideshow" ? (
        <>
          <div
            className="flex-1 relative flex items-center justify-center overflow-hidden bg-gray-50 select-none"
            style={{ minHeight: "calc(100vh - 240px)" }}
            onTouchStart={(e) => setTouchStart(e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (touchStart === null) return;
              const d = touchStart - e.changedTouches[0].clientX;
              if (Math.abs(d) > 50) (d > 0 ? next() : prev());
              setTouchStart(null);
            }}
          >
            {/* Outgoing photo (stays underneath while the new one fades in) */}
            {outSlide?.type === "photo" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`out-${outgoing}`}
                src={outSlide.url}
                alt=""
                className="absolute max-w-full object-contain px-4 sm:px-16"
                style={{ maxHeight: "calc(100vh - 240px)", zIndex: 0 }}
              />
            )}

            {/* Current slide */}
            {slide.type === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`in-${current}`}
                src={slide.url}
                alt={slide.category ?? ""}
                className="absolute max-w-full object-contain px-4 sm:px-16"
                style={{ maxHeight: "calc(100vh - 240px)", zIndex: 1, opacity: incomingReady ? 1 : 0, transition: "opacity 0.5s ease" }}
              />
            ) : (
              <video
                key={`v-${current}`}
                src={slide.url}
                controls
                playsInline
                preload="metadata"
                className="absolute w-full"
                style={{ maxHeight: "calc(100vh - 240px)", zIndex: 1, objectFit: "contain", opacity: incomingReady ? 1 : 0, transition: "opacity 0.5s ease" }}
              />
            )}

            {slides.length > 1 && (
              <>
                <button onClick={prev} aria-label="Previous" className="absolute left-3 bg-black/30 hover:bg-black/60 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition-colors" style={{ zIndex: 2 }}>‹</button>
                <button onClick={next} aria-label="Next" className="absolute right-3 bg-black/30 hover:bg-black/60 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition-colors" style={{ zIndex: 2 }}>›</button>
              </>
            )}
          </div>

          <div className="text-center py-2 px-4 bg-white">
            <p className="text-gray-500 text-sm">
              {caption ? `${caption} · ` : ""}
              {current + 1} / {slides.length}
            </p>
          </div>

          <div className="flex gap-2 px-4 pb-4 overflow-x-auto bg-white">
            {slides.map((s, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={`shrink-0 rounded-md overflow-hidden transition-all ${i === current ? "ring-2 ring-[#d4a843] opacity-100" : "opacity-40 hover:opacity-70"}`}
              >
                {s.type === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.url} alt="" className="w-16 h-10 object-cover" />
                ) : (
                  videoTile("w-16 h-10")
                )}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="flex-1 p-4 sm:p-6 overflow-auto bg-white">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-w-5xl mx-auto">
            {slides.map((s, i) => (
              <button
                key={i}
                onClick={() => { setView("slideshow"); goTo(i); }}
                className="aspect-[4/3] rounded-lg overflow-hidden bg-gray-100"
              >
                {s.type === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.url} alt="" className="w-full h-full object-cover" />
                ) : (
                  videoTile("w-full h-full")
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
