"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

type Slide =
  | { type: "photo"; url: string; category: string | null }
  | { type: "video"; url: string; filename: string | null };

/**
 * A photograph that reveals itself only once it has decoded — no pop-in,
 * no layout shift. Until the image arrives, a quiet paper shimmer holds
 * its place. Signed URLs stay raw <img> (never next/image — the optimizer
 * would cache expiring URLs).
 */
function FadePhoto({
  src,
  alt,
  eager = false,
  className = "",
}: {
  src: string;
  alt: string;
  eager?: boolean;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const el = imgRef.current;
    // Neighbours are preloaded, so the incoming image is usually already
    // cached. Flipping to opacity-100 synchronously would skip the transition
    // entirely — the photo would just appear on top of the old one. Paint one
    // frame at opacity 0, then flip on the next frame so the fade actually runs.
    if (el && el.complete && el.naturalWidth > 0) {
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setLoaded(true));
      });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
  }, [src]);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`${className} transition-opacity duration-[1200ms] ease-quiet ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </>
  );
}

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
  const [showThumbs, setShowThumbs] = useState(false);
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
      const t = setTimeout(() => setOutgoing(null), 1300);
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

  // Warm the neighbouring photographs so paging feels instant.
  useEffect(() => {
    [current - 1, current + 1].forEach((i) => {
      const idx = slides.length ? (i + slides.length) % slides.length : -1;
      const s = slides[idx];
      if (s && s.type === "photo" && s.url) {
        const img = new window.Image();
        img.decoding = "async";
        img.src = s.url;
      }
    });
  }, [current, slides]);

  if (slides.length === 0) {
    return (
      <div className="min-h-screen bg-ink-50 flex items-center justify-center px-6 text-center">
        <div>
          <p className="label-caps text-accent-700">YachtPics</p>
          <p className="text-ink-500 text-sm mt-3">This gallery doesn&apos;t have any photos yet.</p>
        </div>
      </div>
    );
  }

  const slide = slides[current];
  const outSlide = outgoing !== null ? slides[outgoing] : null;
  const caption = slide.type === "video" ? "Video" : slide.category ?? "";

  const tabClass = (active: boolean) =>
    `text-xs font-medium px-3 min-h-[44px] sm:min-h-0 sm:py-1.5 rounded-[6px] transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
      active ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-900"
    }`;

  const arrowClass =
    "absolute top-1/2 -translate-y-1/2 z-[2] flex h-11 w-11 items-center justify-center rounded-full " +
    "border border-hairline bg-white text-ink-700 text-2xl leading-none shadow-elev-1 " +
    "hover:bg-ink-50 hover:text-ink-950 transition-colors duration-base ease-quiet " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500";

  const videoTile = (size: string) => (
    <div className={`${size} bg-ink-900 flex items-center justify-center`}>
      <svg className="w-1/4 h-1/4 text-white" fill="currentColor" viewBox="0 0 20 20">
        <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
      </svg>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink-50 flex flex-col">
      {/* Header — one hairline between the gallery and its photographs */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-hairline gap-4">
        <div className="min-w-0">
          <p className="label-caps text-accent-700">YachtPics</p>
          <h1 className="text-ink-900 font-semibold text-base sm:text-lg truncate mt-0.5">{title}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {slides.length > 1 && view === "slideshow" && (
            <button
              onClick={() => setPlaying((p) => !p)}
              className="text-xs font-medium px-3 min-h-[44px] rounded-ctl border border-hairline bg-white text-ink-600 shadow-elev-1 hover:text-ink-900 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
          )}
          <div className="flex items-center gap-1 rounded-ctl border border-hairline bg-white p-1 shadow-elev-1">
            <button onClick={() => setView("slideshow")} className={tabClass(view === "slideshow")}>
              Slideshow
            </button>
            <button onClick={() => setView("grid")} className={tabClass(view === "grid")}>
              All Photos
            </button>
          </div>
        </div>
      </div>

      {view === "slideshow" ? (
        <>
          {/* Main slide — a print on paper: the photograph claims the stage, lifted by its shadow */}
          <div
            className="flex-1 relative select-none overflow-hidden"
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
              <div
                key={`out-${outgoing}`}
                className="absolute inset-0 flex items-center justify-center p-2 sm:p-5"
                style={{
                  zIndex: 0,
                  opacity: incomingReady ? 0 : 1,
                  // Stay fully opaque underneath for the WHOLE incoming fade, then
                  // clean up. The old photo never drops below 1 while the new one
                  // dissolves in on top, so the stage is always covered (no white
                  // bleed / flash) yet the two visibly blend — a true crossfade.
                  transition: "opacity 400ms cubic-bezier(0.25, 0, 0.15, 1) 800ms",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={outSlide.url}
                  alt=""
                  decoding="sync"
                  className="max-h-full max-w-full object-contain rounded-[2px] shadow-print"
                />
              </div>
            )}

            {/* Current slide */}
            {slide.type === "photo" ? (
              <div
                key={`in-${current}`}
                className="absolute inset-0 flex items-center justify-center p-2 sm:p-5"
                style={{ zIndex: 1 }}
              >
                <FadePhoto
                  src={slide.url}
                  alt={slide.category ?? ""}
                  eager
                  className="max-h-full max-w-full object-contain rounded-[2px] shadow-print"
                />
              </div>
            ) : (
              <video
                key={`v-${current}`}
                src={slide.url}
                controls
                playsInline
                preload="metadata"
                className="absolute inset-0 h-full w-full"
                style={{
                  zIndex: 1,
                  opacity: incomingReady ? 1 : 0,
                  transition: "opacity 1200ms cubic-bezier(0.25, 0, 0.15, 1)",
                  objectFit: "contain",
                  background: "transparent",
                }}
              />
            )}

            {slides.length > 1 && (
              <>
                <button onClick={prev} aria-label="Previous" className={`${arrowClass} left-3`}>
                  ‹
                </button>
                <button onClick={next} aria-label="Next" className={`${arrowClass} right-3`}>
                  ›
                </button>
              </>
            )}
          </div>

          {/* Caption + counter, with a filmstrip toggle */}
          <div className="flex items-center justify-center gap-3 pt-2 pb-1.5 px-4">
            <p className="label-caps text-ink-600">
              {caption ? `${caption} · ` : ""}
              {current + 1} / {slides.length}
            </p>
            {slides.length > 1 && (
              <button
                onClick={() => setShowThumbs((v) => !v)}
                aria-label={showThumbs ? "Hide thumbnails" : "Show thumbnails"}
                aria-pressed={showThumbs}
                className={`flex h-6 w-6 items-center justify-center rounded transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${showThumbs ? "text-ink-800" : "text-ink-400 hover:text-ink-700"}`}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <rect x="2" y="6" width="4" height="8" rx="1" />
                  <rect x="8" y="6" width="4" height="8" rx="1" />
                  <rect x="14" y="6" width="4" height="8" rx="1" />
                </svg>
              </button>
            )}
          </div>

          {/* Thumbnail strip — hidden by default so the photograph claims the space; toggle to reveal */}
          {showThumbs && (
          <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto scrollbar-hide">
            {slides.map((s, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === current}
                className={`shrink-0 overflow-hidden transition-opacity duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                  i === current ? "opacity-100 ring-1 ring-accent-500" : "opacity-50 hover:opacity-100"
                }`}
              >
                {s.type === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.url} alt="" loading="lazy" decoding="async" className="w-[70px] h-11 object-cover" />
                ) : (
                  videoTile("w-[70px] h-11")
                )}
              </button>
            ))}
          </div>
          )}
        </>
      ) : (
        /* Grid view — a gallery wall on paper: prints on white mats, lifted by their shadows */
        <div className="flex-1 px-3 sm:px-5 py-4 overflow-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4 max-w-5xl mx-auto">
            {slides.map((s, i) => (
              <button
                key={i}
                onClick={() => { setView("slideshow"); goTo(i); }}
                aria-label={`Open slide ${i + 1}`}
                className="aspect-[4/3] relative overflow-hidden rounded-[2px] bg-white shadow-print focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50"
              >
                {s.type === "photo" ? (
                  <FadePhoto
                    src={s.url}
                    alt={s.category ?? `Photo ${i + 1}`}
                    eager={i < 4}
                    className="absolute inset-0 h-full w-full object-contain"
                  />
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
