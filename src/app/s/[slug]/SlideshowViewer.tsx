"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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
}

export default function SlideshowViewer({ listingId, slug, listing, broker: initialBroker, photos, videos = [], brokerId }: Props) {
  const [view, setView] = useState<"slideshow" | "grid">("slideshow");
  const [current, setCurrent] = useState(0);
  const [outgoing, setOutgoing] = useState<number | null>(null);
  const [incomingReady, setIncomingReady] = useState(true);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [broker, setBroker] = useState<BrokerInfo>(initialBroker);

  // Track view once per session
  useEffect(() => {
    const key = `viewed_${slug}`;
    if (typeof sessionStorage !== "undefined" && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      fetch("/api/slideshow/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, slug }),
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
    if (idx === current || idx < 0 || idx >= photos.length) return;
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
  }, [current, photos.length]);

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

  if (photos.length === 0 && videos.length === 0) {
    return (
      <div className="min-h-screen bg-[#050b14] flex items-center justify-center">
        <p className="text-gray-500 text-sm">No photos available.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050b14] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e3a5f] gap-4">
        <div className="min-w-0">
          <h1 className="text-white font-semibold text-base sm:text-lg truncate">
            {vesselTitle || "Vessel"}
          </h1>
          {vesselDetails && (
            <p className="text-gray-400 text-xs sm:text-sm mt-0.5 truncate">{vesselDetails}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 bg-[#0a1628] rounded-lg p-1">
          <button
            onClick={() => setView("slideshow")}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors font-medium ${
              view === "slideshow"
                ? "bg-[#d4a843] text-[#050b14]"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Slideshow
          </button>
          <button
            onClick={() => setView("grid")}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors font-medium ${
              view === "grid"
                ? "bg-[#d4a843] text-[#050b14]"
                : "text-gray-400 hover:text-white"
            }`}
          >
            All Photos
          </button>
        </div>
      </div>

      {/* Videos — shown above the slideshow when present */}
      {videos.length > 0 && view === "slideshow" && (
        <div className="border-b border-[#1e3a5f] px-4 py-4 space-y-3 bg-[#070e1c]">
          {videos.map((video) => video.url && (
            <div key={video.id} className="rounded-xl overflow-hidden">
              <video
                src={video.url}
                controls
                playsInline
                preload="metadata"
                className="w-full max-h-[360px] bg-black"
              />
            </div>
          ))}
        </div>
      )}

      {view === "slideshow" ? (
        <>
          {/* Main photo area */}
          <div
            className="flex-1 relative flex items-center justify-center select-none overflow-hidden"
            style={{ minHeight: "calc(100vh - 240px)" }}
            onTouchStart={(e) => setTouchStart(e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (touchStart === null) return;
              const diff = touchStart - e.changedTouches[0].clientX;
              if (Math.abs(diff) > 50) diff > 0 ? next() : prev();
              setTouchStart(null);
            }}
          >
            {/* Outgoing photo */}
            {outgoing !== null && photos[outgoing]?.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`out-${outgoing}`}
                src={photos[outgoing].url!}
                alt=""
                className="absolute max-w-full object-contain px-16"
                style={{ maxHeight: "calc(100vh - 240px)", zIndex: 0 }}
              />
            )}

            {/* Current photo */}
            {photos[current]?.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`in-${current}`}
                src={photos[current].url!}
                alt={photos[current].category ?? ""}
                className="absolute max-w-full object-contain px-16"
                style={{
                  maxHeight: "calc(100vh - 240px)",
                  zIndex: 1,
                  opacity: incomingReady ? 1 : 0,
                  transition: "opacity 0.5s ease",
                }}
              />
            )}

            {/* Prev button */}
            {current > 0 && (
              <button
                onClick={prev}
                className="absolute left-3 bg-black/40 hover:bg-black/70 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition-colors"
                style={{ zIndex: 2 }}
              >
                ‹
              </button>
            )}

            {/* Next button */}
            {current < photos.length - 1 && (
              <button
                onClick={next}
                className="absolute right-3 bg-black/40 hover:bg-black/70 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl transition-colors"
                style={{ zIndex: 2 }}
              >
                ›
              </button>
            )}
          </div>

          {/* Caption + counter */}
          <div className="text-center py-2 px-4">
            <p className="text-gray-400 text-sm">
              {photos[current]?.category
                ? `${photos[current].category} · `
                : ""}
              {current + 1} / {photos.length}
            </p>
          </div>

          {/* Thumbnail strip */}
          <div className="flex gap-2 px-4 pb-4 overflow-x-auto scrollbar-hide">
            {photos.map((photo, i) => (
              <button
                key={photo.id}
                onClick={() => goTo(i)}
                className={`shrink-0 rounded-md overflow-hidden transition-all ${
                  i === current
                    ? "ring-2 ring-[#d4a843] opacity-100"
                    : "opacity-40 hover:opacity-70"
                }`}
              >
                {photo.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.url}
                    alt=""
                    className="w-16 h-10 object-cover"
                  />
                )}
              </button>
            ))}
          </div>
        </>
      ) : (
        /* Grid view */
        <div className="flex-1 p-4 sm:p-6 overflow-auto">
          {/* Videos appear first in grid view */}
          {videos.length > 0 && (
            <div className="mb-6 space-y-4">
              {videos.map((video) => video.url && (
                <div key={video.id} className="rounded-xl overflow-hidden border border-[#1e3a5f]">
                  <video
                    src={video.url}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[420px] bg-black"
                  />
                  {video.filename && (
                    <div className="px-4 py-2 bg-[#0a1628]">
                      <p className="text-gray-400 text-xs truncate">{video.filename}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos.map((photo, i) => (
              <div
                key={photo.id}
                onClick={() => {
                  setCurrent(i);
                  setView("slideshow");
                }}
                className="cursor-pointer rounded-lg overflow-hidden border border-[#1e3a5f] hover:border-[#d4a843] transition-colors"
              >
                {photo.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.url}
                    alt=""
                    className="w-full h-40 object-contain bg-[#0a1628]"
                  />
                )}
                <div className="p-2 bg-[#0a1628]">
                  <p className="text-gray-400 text-xs">
                    {String(i + 1).padStart(2, "0")} · {photo.category ?? "Other"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Broker footer */}
      <div className="border-t border-[#1e3a5f] px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {broker.logoUrl && (
            <div className="shrink-0 h-10 w-24 bg-white rounded flex items-center justify-center p-1.5 overflow-hidden">
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
            <p className="text-white text-sm font-semibold truncate">{broker.name}</p>
            {broker.brokerage && (
              <p className="text-gray-400 text-xs mt-0.5 truncate">{broker.brokerage}</p>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
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
              className="text-gray-400 text-xs hover:text-gray-200 transition-colors"
            >
              {broker.website.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
