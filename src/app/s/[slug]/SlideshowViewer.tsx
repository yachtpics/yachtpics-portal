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

export default function SlideshowViewer({ listingId, slug, listing, broker: initialBroker, photos, videos = [], brokerId, source = "link" }: Props) {
  // Videos first, then photos — unified slide array
  const slides = useMemo<Slide[]>(() => [
    ...videos.filter(v => v.url).map(v => ({ type: "video" as const, ...v })),
    ...photos.map(p => ({ type: "photo" as const, ...p })),
  ], [videos, photos]);

  const videoCount = videos.filter(v => v.url).length;

  const [view, setView] = useState<"slideshow" | "grid">("slideshow");
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

  if (slides.length === 0) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-gray-400 text-sm">No photos available.</p>
      </div>
    );
  }

  const currentSlide = slides[current];
  const outgoingSlide = outgoing !== null ? slides[outgoing] : null;
  const isVideoSlide = currentSlide.type === "video";

  const caption = isVideoSlide
    ? "Video"
    : (currentSlide as { category: string | null }).category ?? "";

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 gap-4">
        <div className="min-w-0">
          <h1 className="text-gray-900 font-semibold text-base sm:text-lg truncate">
            {vesselTitle || "Vessel"}
          </h1>
          {vesselDetails && (
            <p className="text-gray-500 text-xs sm:text-sm mt-0.5 truncate">{vesselDetails}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setView("slideshow")}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors font-medium ${
              view === "slideshow"
                ? "bg-[#d4a843] text-white"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            Slideshow
          </button>
          <button
            onClick={() => setView("grid")}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors font-medium ${
              view === "grid"
                ? "bg-[#d4a843] text-white"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            All Photos
          </button>
        </div>
      </div>

      {view === "slideshow" ? (
        <>
          {/* Main slide area — video and photo use the same full-height container */}
          <div
            className="flex-1 relative flex items-center justify-center select-none overflow-hidden bg-gray-50"
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
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`out-${outgoing}`}
                src={outgoingSlide.url}
                alt=""
                className="absolute max-w-full object-contain px-16"
                style={{ maxHeight: "calc(100vh - 240px)", zIndex: 0 }}
              />
            )}

            {/* Current slide */}
            {currentSlide.url && (
              currentSlide.type === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`in-${current}`}
                  src={currentSlide.url}
                  alt={currentSlide.category ?? ""}
                  className="absolute max-w-full object-contain px-16"
                  style={{
                    maxHeight: "calc(100vh - 240px)",
                    zIndex: 1,
                    opacity: incomingReady ? 1 : 0,
                    transition: "opacity 0.5s ease",
                  }}
                />
              ) : (
                <video
                  key={`video-${current}`}
                  src={currentSlide.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="absolute w-full"
                  style={{
                    maxHeight: "calc(100vh - 240px)",
                    zIndex: 1,
                    opacity: incomingReady ? 1 : 0,
                    transition: "opacity 0.5s ease",
                    objectFit: "contain",
                    background: "transparent",
                  }}
                />
              )
            )}

            {/* Prev */}
            {current > 0 && (
              <button
                onClick={prev}
                className="absolute left-3 bg-black/30 hover:bg-black/60 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition-colors"
                style={{ zIndex: 2 }}
              >
                ‹
              </button>
            )}

            {/* Next */}
            {current < slides.length - 1 && (
              <button
                onClick={next}
                className="absolute right-3 bg-black/30 hover:bg-black/60 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition-colors"
                style={{ zIndex: 2 }}
              >
                ›
              </button>
            )}
          </div>

          {/* Caption + counter */}
          <div className="text-center py-2 px-4 bg-white">
            <p className="text-gray-500 text-sm">
              {caption ? `${caption} · ` : ""}
              {current + 1} / {slides.length}
            </p>
          </div>

          {/* Thumbnail strip — videos show as dark tile with play icon */}
          <div className="flex gap-2 px-4 pb-4 overflow-x-auto scrollbar-hide bg-white">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                onClick={() => goTo(i)}
                className={`shrink-0 rounded-md overflow-hidden transition-all ${
                  i === current
                    ? "ring-2 ring-[#d4a843] opacity-100"
                    : "opacity-40 hover:opacity-70"
                }`}
              >
                {slide.type === "photo" && slide.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slide.url} alt="" className="w-16 h-10 object-cover" />
                ) : (
                  <div className="w-16 h-10 bg-gray-900 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>
        </>
      ) : (
        /* Grid view */
        <div className="flex-1 p-4 sm:p-6 overflow-auto bg-white">
          {videos.length > 0 && (
            <div className="mb-6 space-y-4">
              {videos.map((video) => video.url && (
                <div key={video.id} className="rounded-xl overflow-hidden bg-black">
                  <video
                    src={video.url}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[480px] bg-black"
                  />
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos.map((photo, i) => (
              <div
                key={photo.id}
                onClick={() => {
                  setCurrent(videoCount + i);
                  setView("slideshow");
                }}
                className="cursor-pointer rounded-lg overflow-hidden border border-gray-200 hover:border-[#d4a843] transition-colors"
              >
                {photo.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.url}
                    alt=""
                    onLoad={(e) => handleImgLoad(e, photo.id)}
                    className={`w-full object-cover ${verticalIds.has(photo.id) ? "aspect-[3/4]" : "aspect-[4/3]"}`}
                  />
                )}
                <div className="p-2 bg-gray-50">
                  <p className="text-gray-500 text-xs">
                    {String(i + 1).padStart(2, "0")} · {photo.category ?? "Other"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Broker footer */}
      <div className="border-t border-gray-200 px-5 py-4 flex items-center justify-between gap-4 bg-white">
        <div className="flex items-center gap-3 min-w-0">
          {broker.logoUrl && (
            <div className="shrink-0 h-10 w-24 border border-gray-200 rounded flex items-center justify-center p-1.5 overflow-hidden">
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
            <p className="text-gray-900 text-sm font-semibold truncate">{broker.name}</p>
            {broker.brokerage && (
              <p className="text-gray-500 text-xs mt-0.5 truncate">{broker.brokerage}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => { setInquireOpen(true); setInqSent(false); setInqError(""); }}
            className="bg-[#050b14] hover:bg-[#0a1628] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
          >
            Request Info
          </button>
          <div className="text-right">
            {broker.phone && (
              <a
                href={`tel:${broker.phone}`}
                className="text-[#d4a843] text-sm font-medium block hover:text-[#c49a35] transition-colors"
              >
                {broker.phone}
              </a>
            )}
            {broker.website && (
              <a
                href={broker.website.startsWith("http") ? broker.website : `https://${broker.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-500 text-xs hover:text-gray-700 transition-colors"
              >
                {broker.website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Inquiry modal */}
      {inquireOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setInquireOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-3 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Request information</h2>
                <p className="text-xs text-gray-400 mt-0.5">{listing.vessel_name ?? "This listing"}</p>
              </div>
              <button onClick={() => setInquireOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            {inqSent ? (
              <div className="px-6 py-10 text-center">
                <p className="text-green-600 text-2xl mb-2">✓</p>
                <p className="text-gray-900 font-semibold text-sm">Thanks — your message is on its way.</p>
                <p className="text-gray-500 text-xs mt-1">{broker.name} will be in touch shortly.</p>
                <button onClick={() => setInquireOpen(false)} className="mt-5 text-sm text-gray-500 hover:text-gray-700">Close</button>
              </div>
            ) : (
              <form onSubmit={submitInquiry} className="px-6 py-5 space-y-3">
                <input value={inq.name} onChange={(e) => setInq({ ...inq, name: e.target.value })} required placeholder="Your name"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a843]" />
                <input type="email" value={inq.email} onChange={(e) => setInq({ ...inq, email: e.target.value })} required placeholder="Email"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a843]" />
                <input value={inq.phone} onChange={(e) => setInq({ ...inq, phone: e.target.value })} placeholder="Phone (optional)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a843]" />
                <textarea value={inq.message} onChange={(e) => setInq({ ...inq, message: e.target.value })} rows={3} placeholder={`I'm interested in ${listing.vessel_name ?? "this yacht"}…`}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a843] resize-none" />
                {inqError && <p className="text-xs text-red-600">{inqError}</p>}
                <button type="submit" disabled={inqBusy || !inq.name.trim() || !inq.email.trim()}
                  className="w-full bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold py-2.5 rounded-lg transition-colors">
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
