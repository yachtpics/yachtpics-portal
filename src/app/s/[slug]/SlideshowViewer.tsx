"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

interface Photo {
  id: string;
  url: string | null;
  category: string | null;
  filename: string | null;
}

interface Video {
  id: string;
  url: string | null;
  filename: string | null;
}

type Slide =
  | { type: "photo"; id: string; url: string | null; category: string | null; filename: string | null }
  | { type: "video"; id: string; url: string | null; filename: string | null };

interface Listing {
  vessel_name: string | null;
  vessel_type: string | null;
  year: number | null;
  length_ft: number | null;
  make: string | null;
  model: string | null;
  asking_price: number | null;
  location: string | null;
  description?: string | null;
  beam_ft?: number | null;
  draft_ft?: number | null;
  staterooms?: number | null;
  heads?: number | null;
  engines?: string | null;
  engine_hours?: number | null;
  fuel_type?: string | null;
  cruising_speed_kn?: number | null;
  max_speed_kn?: number | null;
  hull_material?: string | null;
}

interface BrokerInfo {
  name: string;
  brokerage: string | null;
  phone: string | null;
  website: string | null;
  logoUrl: string | null;
}

interface Props {
  listingId: string;
  slug: string;
  listing: Listing;
  broker: BrokerInfo;
  photos: Photo[];
  videos?: Video[];
  brokerId?: string;
  source?: string;
}

/**
 * A photograph that reveals itself only once it has decoded — no pop-in,
 * no layout shift. The parent supplies a `relative` box with a reserved
 * aspect ratio; until the image arrives, a quiet paper shimmer holds its place.
 *
 * These are time-limited signed Supabase URLs, so they intentionally stay
 * raw <img> (never next/image — the optimizer would cache expiring URLs).
 */
function FadePhoto({
  src,
  alt,
  eager = false,
  className = "",
  fadeMs = 160,
  onLoad,
}: {
  src: string;
  alt: string;
  eager?: boolean;
  className?: string;
  fadeMs?: number;
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const el = imgRef.current;
    // Neighbours are preloaded, so the incoming image is usually already
    // cached — left alone it paints at full opacity on its first frame, which
    // reads as a hard cut. Paint one frame at opacity 0, then flip on the next
    // frame so the opacity transition actually runs (a real crossfade).
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
      {!loaded && <div aria-hidden className="absolute inset-0 animate-pulse bg-ink-950/[0.05]" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={(e) => {
          setLoaded(true);
          onLoad?.(e);
        }}
        style={{
          opacity: loaded ? 1 : 0,
          transition: `opacity ${fadeMs}ms cubic-bezier(0.25, 0, 0.15, 1)`,
        }}
        className={className}
      />
    </>
  );
}

export default function SlideshowViewer({ listingId, slug, listing, broker: initialBroker, photos, videos = [], brokerId, source = "link" }: Props) {
  // Videos first, then photos — unified slide array
  const slides = useMemo<Slide[]>(() => [
    ...videos.filter(v => v.url).map(v => ({ type: "video" as const, ...v })),
    ...photos.map(p => ({ type: "photo" as const, ...p })),
  ], [videos, photos]);

  const videoCount = videos.filter(v => v.url).length;

  const [view, setView] = useState<"slideshow" | "grid" | "details">("slideshow");
  const [current, setCurrent] = useState(0);
  const [outgoing, setOutgoing] = useState<number | null>(null);
  const [incomingReady, setIncomingReady] = useState(true);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [broker, setBroker] = useState<BrokerInfo>(initialBroker);
  const [verticalIds, setVerticalIds] = useState<Set<string>>(new Set());

  // Inquiry form
  const [inquireOpen, setInquireOpen] = useState(false);
  const [inq, setInq] = useState({ name: "", email: "", phone: "", message: "" });
  const [inqBusy, setInqBusy] = useState(false);
  const [inqSent, setInqSent] = useState(false);
  const [inqError, setInqError] = useState("");

  async function submitInquiry(e: React.FormEvent) {
    e.preventDefault();
    if (!inq.name.trim() || !inq.email.trim()) return;
    setInqBusy(true);
    setInqError("");
    try {
      const res = await fetch(`/api/s/${slug}/inquire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...inq, source }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setInqSent(true);
    } catch (err) {
      setInqError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setInqBusy(false);
    }
  }

  function handleImgLoad(e: React.SyntheticEvent<HTMLImageElement>, id: string) {
    const img = e.currentTarget;
    if (img.naturalHeight > img.naturalWidth) {
      setVerticalIds((prev) => { const next = new Set(prev); next.add(id); return next; });
    }
  }

  // Track view once per session
  useEffect(() => {
    const key = `viewed_${slug}`;
    if (typeof sessionStorage !== "undefined" && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      fetch("/api/slideshow/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, slug, source }),
      }).catch(() => {});
    }
  }, [listingId, slug]);

  useEffect(() => {
    if (!brokerId) return;
    fetch(`/api/broker-details?id=${brokerId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d && !d.error) {
          setBroker((prev) => ({
            ...prev,
            brokerage: d.brokerage_name ?? prev.brokerage,
            website: d.brokerage_website ?? prev.website,
            logoUrl: d.logo_url ?? prev.logoUrl,
          }));
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokerId]);

  const goTo = useCallback((idx: number) => {
    if (idx === current || idx < 0 || idx >= slides.length) return;
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    setOutgoing(current);
    setIncomingReady(false);
    setCurrent(idx);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIncomingReady(true);
      });
    });
    fadeTimerRef.current = setTimeout(() => setOutgoing(null), 600);
  }, [current, slides.length]);

  const prev = useCallback(() => goTo(current - 1), [goTo, current]);
  const next = useCallback(() => goTo(current + 1), [goTo, current]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (view !== "slideshow") return;
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [view, prev, next]);

  // Warm the neighbouring photographs so paging feels instant.
  useEffect(() => {
    [current - 1, current + 1].forEach((i) => {
      const s = slides[i];
      if (s && s.type === "photo" && s.url) {
        const img = new window.Image();
        img.decoding = "async";
        img.src = s.url;
      }
    });
  }, [current, slides]);

  const vesselTitle = [listing.year, listing.make, listing.model, listing.vessel_name]
    .filter(Boolean)
    .join(" ");
  const vesselDetails = [
    listing.vessel_type,
    listing.length_ft ? `${listing.length_ft}′` : null,
    listing.location,
    listing.asking_price
      ? `$${listing.asking_price.toLocaleString("en-US")}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const specRows: [string, string][] = [];
  const addSpec = (label: string, val: unknown, suffix = "") => {
    if (val !== null && val !== undefined && val !== "") specRows.push([label, `${val}${suffix}`]);
  };
  addSpec("Year", listing.year);
  addSpec("Length", listing.length_ft, "′");
  addSpec("Beam", listing.beam_ft, "′");
  addSpec("Draft", listing.draft_ft, "′");
  addSpec("Staterooms", listing.staterooms);
  addSpec("Heads", listing.heads);
  addSpec("Engines", listing.engines);
  addSpec("Engine Hours", listing.engine_hours != null ? Number(listing.engine_hours).toLocaleString("en-US") : null);
  addSpec("Fuel", listing.fuel_type);
  addSpec("Cruising", listing.cruising_speed_kn, " kn");
  addSpec("Max Speed", listing.max_speed_kn, " kn");
  addSpec("Hull", listing.hull_material);
  addSpec("Location", listing.location);
  const hasDetails = specRows.length > 0 || !!listing.description;

  if (slides.length === 0) {
    return (
      <div className="min-h-screen bg-ink-50 flex items-center justify-center">
        <p className="label-caps text-ink-600">No photos available</p>
      </div>
    );
  }

  const currentSlide = slides[current];
  const outgoingSlide = outgoing !== null ? slides[outgoing] : null;
  const isVideoSlide = currentSlide.type === "video";

  const caption = isVideoSlide
    ? "Video"
    : (currentSlide as { category: string | null }).category ?? "";

  const tabClass = (active: boolean) =>
    `text-xs font-medium px-3 min-h-[44px] sm:min-h-0 sm:py-1.5 rounded-[6px] transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
      active ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-900"
    }`;

  const arrowClass =
    "absolute top-1/2 -translate-y-1/2 z-[2] flex h-11 w-11 items-center justify-center rounded-full " +
    "border border-hairline bg-white text-ink-700 text-2xl leading-none shadow-elev-1 " +
    "hover:bg-ink-50 hover:text-ink-950 transition-colors duration-base ease-quiet " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500";

  return (
    <div className="min-h-screen bg-ink-50 flex flex-col">
      {/* Header — one hairline between the vessel and its photographs */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-hairline gap-4">
        <div className="min-w-0">
          <h1 className="text-ink-900 font-semibold text-base sm:text-lg truncate">
            {vesselTitle || "Vessel"}
          </h1>
          {vesselDetails && (
            <p className="text-ink-600 text-xs sm:text-sm mt-0.5 truncate">{vesselDetails}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 rounded-ctl border border-hairline bg-white p-1 shadow-elev-1">
          <button onClick={() => setView("slideshow")} className={tabClass(view === "slideshow")}>
            Slideshow
          </button>
          <button onClick={() => setView("grid")} className={tabClass(view === "grid")}>
            All Photos
          </button>
          {hasDetails && (
            <button onClick={() => setView("details")} className={tabClass(view === "details")}>
              Details
            </button>
          )}
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
              const diff = touchStart - e.changedTouches[0].clientX;
              if (Math.abs(diff) > 50) diff > 0 ? next() : prev();
              setTouchStart(null);
            }}
          >
            {/* Outgoing photo (don't show outgoing video to avoid audio overlap) */}
            {outgoingSlide?.type === "photo" && outgoingSlide.url && (
              <div
                key={`out-${outgoing}`}
                className="absolute inset-0 flex items-center justify-center p-2 sm:p-5"
                style={{ zIndex: 0 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={outgoingSlide.url}
                  alt=""
                  className="max-h-full max-w-full object-contain rounded-[2px] shadow-print"
                />
              </div>
            )}

            {/* Current slide */}
            {currentSlide.url && (
              currentSlide.type === "photo" ? (
                <div
                  key={`in-${current}`}
                  className="absolute inset-0 flex items-center justify-center p-2 sm:p-5"
                  style={{ zIndex: 1 }}
                >
                  <FadePhoto
                    src={currentSlide.url}
                    alt={currentSlide.category ?? ""}
                    eager
                    fadeMs={500}
                    className="max-h-full max-w-full object-contain rounded-[2px] shadow-print"
                  />
                </div>
              ) : (
                <video
                  key={`video-${current}`}
                  src={currentSlide.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 h-full w-full"
                  style={{
                    zIndex: 1,
                    opacity: incomingReady ? 1 : 0,
                    transition: "opacity 220ms cubic-bezier(0.25, 0, 0.15, 1)",
                    objectFit: "contain",
                    background: "transparent",
                  }}
                />
              )
            )}

            {/* Prev */}
            {current > 0 && (
              <button onClick={prev} aria-label="Previous photo" className={`${arrowClass} left-3`}>
                ‹
              </button>
            )}

            {/* Next */}
            {current < slides.length - 1 && (
              <button onClick={next} aria-label="Next photo" className={`${arrowClass} right-3`}>
                ›
              </button>
            )}
          </div>

          {/* Caption + counter */}
          <div className="text-center pt-2 pb-1.5 px-4">
            <p className="label-caps text-ink-600">
              {caption ? `${caption} · ` : ""}
              {current + 1} / {slides.length}
            </p>
          </div>

          {/* Thumbnail strip — videos show as dark tile with play icon */}
          <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto scrollbar-hide">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                onClick={() => goTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === current}
                className={`shrink-0 overflow-hidden transition-opacity duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                  i === current
                    ? "opacity-100 ring-1 ring-accent-500"
                    : "opacity-50 hover:opacity-100"
                }`}
              >
                {slide.type === "photo" && slide.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slide.url} alt="" loading="lazy" decoding="async" className="w-[70px] h-11 object-cover" />
                ) : (
                  <div className="w-[70px] h-11 bg-ink-900 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>
        </>
      ) : view === "grid" ? (
        /* Grid view — a gallery wall on paper: large prints on white mats, lifted by their shadows */
        <div className="flex-1 px-3 sm:px-5 py-4 overflow-auto">
          {videos.length > 0 && (
            <div className="mb-4 space-y-4">
              {videos.map((video) => video.url && (
                <div key={video.id} className="overflow-hidden rounded-[2px] bg-ink-950 shadow-print">
                  <video
                    src={video.url}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[480px]"
                  />
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            {photos.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => {
                  setCurrent(videoCount + i);
                  setView("slideshow");
                }}
                aria-label={`Open photo ${i + 1}${photo.category ? ` — ${photo.category}` : ""}`}
                className={`group relative w-full overflow-hidden rounded-[2px] bg-white shadow-print focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 ${
                  verticalIds.has(photo.id) ? "aspect-[3/4]" : "aspect-[4/3]"
                }`}
              >
                {photo.url && (
                  <FadePhoto
                    src={photo.url}
                    alt={photo.category ?? `Photo ${i + 1}`}
                    eager={i < 3}
                    onLoad={(e) => handleImgLoad(e, photo.id)}
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                )}
                {/* Caption on demand — the resting state is just the photograph */}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end px-3 pb-2.5 pt-10 bg-gradient-to-t from-ink-950/80 to-transparent opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-base ease-quiet">
                  <span className="label-caps-inverse">
                    {String(i + 1).padStart(2, "0")} · {photo.category ?? "Other"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Details view */
        <div className="flex-1 px-5 sm:px-8 py-8 overflow-auto">
          <div className="max-w-2xl mx-auto">
            {specRows.length > 0 && (
              <>
                <h2 className="label-caps text-ink-600 mb-5">Specifications</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5 mb-10">
                  {specRows.map(([label, val]) => (
                    <div key={label} className="border-t border-hairline pt-2.5">
                      <p className="label-caps text-ink-600">{label}</p>
                      <p className="text-sm text-ink-900 font-medium mt-1">{val}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
            {listing.description && (
              <>
                <h2 className="label-caps text-ink-600 mb-3">About this yacht</h2>
                <p className="text-sm text-ink-700 leading-relaxed whitespace-pre-wrap">{listing.description}</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Broker footer */}
      <div className="border-t border-hairline px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {broker.logoUrl && (
            <div className="shrink-0 h-10 w-24 bg-white border border-hairline rounded-ctl flex items-center justify-center p-1.5 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={broker.logoUrl}
                alt={broker.brokerage ?? broker.name}
                className="max-h-full max-w-full object-contain"
                onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
              />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-ink-900 text-sm font-semibold truncate">{broker.name}</p>
            {broker.brokerage && (
              <p className="text-ink-600 text-xs mt-0.5 truncate">{broker.brokerage}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => { setInquireOpen(true); setInqSent(false); setInqError(""); }}
            className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2.5 min-h-[44px] rounded-ctl transition-colors duration-base ease-quiet whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50"
          >
            Request Info
          </button>
          <div className="text-right">
            {broker.phone && (
              <a
                href={`tel:${broker.phone}`}
                className="text-accent-700 text-sm font-medium block hover:text-accent-600 transition-colors duration-base ease-quiet"
              >
                {broker.phone}
              </a>
            )}
            {broker.website && (
              <a
                href={broker.website.startsWith("http") ? broker.website : `https://${broker.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink-600 text-xs hover:text-ink-900 transition-colors duration-base ease-quiet"
              >
                {broker.website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Inquiry modal */}
      {inquireOpen && (
        <div className="fixed inset-0 z-50 bg-ink-950/80 flex items-center justify-center p-4" onClick={() => setInquireOpen(false)}>
          <div className="bg-white rounded-surface shadow-elev-3 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-3 border-b border-hairline">
              <div>
                <h2 className="text-h2 text-ink-900">Request information</h2>
                <p className="text-xs text-ink-400 mt-0.5">{listing.vessel_name ?? "This listing"}</p>
              </div>
              <button
                onClick={() => setInquireOpen(false)}
                aria-label="Close"
                className="flex h-11 w-11 -mr-2 items-center justify-center text-ink-400 hover:text-ink-600 text-xl leading-none transition-colors duration-fast"
              >
                ✕
              </button>
            </div>
            {inqSent ? (
              <div className="px-6 py-10 text-center">
                <p className="text-success-600 text-2xl mb-2">✓</p>
                <p className="text-ink-900 font-semibold text-sm">Thanks — your message is on its way.</p>
                <p className="text-ink-500 text-xs mt-1">{broker.name} will be in touch shortly.</p>
                <button onClick={() => setInquireOpen(false)} className="mt-5 text-sm text-ink-500 hover:text-ink-700 min-h-[44px] px-4">Close</button>
              </div>
            ) : (
              <form onSubmit={submitInquiry} className="px-6 py-5 space-y-3">
                <input value={inq.name} onChange={(e) => setInq({ ...inq, name: e.target.value })} required placeholder="Your name"
                  className="w-full border border-hairline-strong rounded-ctl px-3 py-2.5 min-h-[44px] text-sm text-ink-900 placeholder-ink-400 focus:outline-none focus:border-accent-500 transition-colors duration-fast" />
                <input type="email" value={inq.email} onChange={(e) => setInq({ ...inq, email: e.target.value })} required placeholder="Email"
                  className="w-full border border-hairline-strong rounded-ctl px-3 py-2.5 min-h-[44px] text-sm text-ink-900 placeholder-ink-400 focus:outline-none focus:border-accent-500 transition-colors duration-fast" />
                <input value={inq.phone} onChange={(e) => setInq({ ...inq, phone: e.target.value })} placeholder="Phone (optional)"
                  className="w-full border border-hairline-strong rounded-ctl px-3 py-2.5 min-h-[44px] text-sm text-ink-900 placeholder-ink-400 focus:outline-none focus:border-accent-500 transition-colors duration-fast" />
                <textarea value={inq.message} onChange={(e) => setInq({ ...inq, message: e.target.value })} rows={3} placeholder={`I'm interested in ${listing.vessel_name ?? "this yacht"}…`}
                  className="w-full border border-hairline-strong rounded-ctl px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 focus:outline-none focus:border-accent-500 transition-colors duration-fast resize-none" />
                {inqError && <p className="text-xs text-danger-600">{inqError}</p>}
                <button type="submit" disabled={inqBusy || !inq.name.trim() || !inq.email.trim()}
                  className="w-full bg-accent-500 hover:bg-accent-400 disabled:opacity-40 text-ink-950 text-sm font-semibold py-2.5 min-h-[44px] rounded-ctl transition-colors duration-base ease-quiet">
                  {inqBusy ? "Sending…" : "Send to broker"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
