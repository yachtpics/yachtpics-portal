"use client";

import { useCallback, useEffect, useState } from "react";

export type Boat = {
  id: string;
  vesselName: string;
  subtitle: string;
  meta: string;
  photographedLabel: string;
  heroUrl: string | null;
  heroFit: "fit" | "fill";
  brokerName: string | null;
  brokerageName: string | null;
  brokerPhone: string | null;
  brokerEmail: string | null;
};

export default function ShowcaseBoard({ boats }: { boats: Boat[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null); // null = thumbnail grid, number = one photo
  const [touchX, setTouchX] = useState<number | null>(null);

  const openBoat = boats.find((b) => b.id === openId) ?? null;

  const open = useCallback(async (id: string) => {
    setOpenId(id);
    setPhotos([]);
    setZoom(null);
    setLoading(true);
    try {
      // no-store: always pull the current photo set + order. Without this the
      // browser can replay a stale list (e.g. old order after a re-sort/re-upload).
      const res = await fetch(`/api/showcase/${id}/photos`, { cache: "no-store" });
      const data = await res.json();
      setPhotos(Array.isArray(data.photos) ? data.photos : []);
    } catch {
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Record a contact tap (phone/email) so admins can see real intent. Fire-and-forget.
  const trackContact = useCallback((listingId: string, detail: "phone" | "email") => {
    fetch("/api/showcase/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "contact_click", listingId, detail }),
    }).catch(() => {});
  }, []);

  const close = useCallback(() => { setOpenId(null); setPhotos([]); setZoom(null); }, []);
  const next = useCallback(() => setZoom((z) => (z === null || !photos.length ? z : (z + 1) % photos.length)), [photos.length]);
  const prev = useCallback(() => setZoom((z) => (z === null || !photos.length ? z : (z - 1 + photos.length) % photos.length)), [photos.length]);

  useEffect(() => {
    if (!openId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { if (zoom === null) close(); else setZoom(null); }
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [openId, zoom, close, next, prev]);

  const arrow =
    "absolute top-1/2 -translate-y-1/2 z-[2] flex h-11 w-11 items-center justify-center rounded-full " +
    "border border-hairline bg-white text-ink-700 text-2xl leading-none shadow-elev-1 hover:bg-ink-50 " +
    "transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500";

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
        {boats.map((b) => (
          <div key={b.id}>
            <button
              onClick={() => open(b.id)}
              title="View all photos"
              className="group block w-full aspect-[4/3] bg-white overflow-hidden rounded-[2px] shadow-print focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              {b.heroUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={b.heroUrl}
                  alt={b.vesselName}
                  loading="lazy"
                  decoding="async"
                  className={`h-full w-full transition-transform duration-base ease-quiet group-hover:scale-[1.015] ${b.heroFit === "fit" ? "object-contain" : "object-cover"}`}
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center label-caps text-ink-300">No photo</span>
              )}
            </button>

            <div className="mt-4">
              {b.photographedLabel && <p className="label-caps text-ink-400">Photographed {b.photographedLabel}</p>}
              <button onClick={() => open(b.id)} className="text-left">
                <h2 className="text-ink-900 font-semibold text-lg mt-1.5 leading-tight hover:text-accent-700 transition-colors duration-fast">
                  {b.vesselName}
                </h2>
              </button>
              {b.subtitle && <p className="text-ink-600 text-sm mt-0.5">{b.subtitle}</p>}
              {b.meta && <p className="text-ink-500 text-xs mt-0.5">{b.meta}</p>}

              <div className="mt-3 pt-3 border-t border-hairline">
                {b.brokerName && <p className="text-ink-900 text-sm font-medium">{b.brokerName}</p>}
                {b.brokerageName && <p className="text-ink-500 text-xs mt-0.5">{b.brokerageName}</p>}
                <div className="mt-1.5 flex flex-col gap-0.5 text-xs">
                  {b.brokerPhone && <a href={`tel:${b.brokerPhone}`} onClick={() => trackContact(b.id, "phone")} className="text-accent-700 hover:text-accent-600 transition-colors duration-fast">{b.brokerPhone}</a>}
                  {b.brokerEmail && <a href={`mailto:${b.brokerEmail}`} onClick={() => trackContact(b.id, "email")} className="text-accent-700 hover:text-accent-600 transition-colors duration-fast truncate">{b.brokerEmail}</a>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {openBoat && (
        <div className="fixed inset-0 z-50 bg-ink-50 flex flex-col" role="dialog" aria-modal="true">
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-hairline gap-4">
            <div className="min-w-0 flex items-center gap-3">
              {zoom !== null && (
                <button
                  onClick={() => setZoom(null)}
                  className="shrink-0 text-xs font-medium text-ink-600 hover:text-ink-900 transition-colors duration-fast"
                >
                  ‹ All photos
                </button>
              )}
              <div className="min-w-0">
                <p className="text-ink-900 font-semibold text-sm truncate">{openBoat.vesselName}</p>
                <p className="label-caps text-ink-500">
                  {loading ? "Loading…" : photos.length === 0 ? "No photos" : zoom === null ? `${photos.length} photo${photos.length === 1 ? "" : "s"}` : `${zoom + 1} / ${photos.length}`}
                </p>
              </div>
            </div>
            <button
              onClick={close}
              aria-label="Close"
              className="shrink-0 flex h-11 w-11 items-center justify-center rounded-full border border-hairline bg-white text-ink-700 text-xl leading-none shadow-elev-1 hover:bg-ink-50 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              ✕
            </button>
          </div>

          {/* Body: thumbnail contact sheet, or one photo */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="label-caps text-ink-400">Loading photos…</p>
            </div>
          ) : photos.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-ink-500 text-sm">No additional photos for this boat.</p>
            </div>
          ) : zoom === null ? (
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3 max-w-5xl mx-auto">
                {photos.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setZoom(i)}
                    className="aspect-square bg-white overflow-hidden rounded-[2px] shadow-print focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div
              className="flex-1 relative overflow-hidden select-none"
              onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
              onTouchEnd={(e) => {
                if (touchX === null) return;
                const diff = touchX - e.changedTouches[0].clientX;
                if (Math.abs(diff) > 50) diff > 0 ? next() : prev();
                setTouchX(null);
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photos[zoom]} alt="" className="max-h-full max-w-full object-contain rounded-[2px] shadow-print" />
              </div>
              {photos.length > 1 && (
                <>
                  <button onClick={prev} aria-label="Previous photo" className={`${arrow} left-3`}>‹</button>
                  <button onClick={next} aria-label="Next photo" className={`${arrow} right-3`}>›</button>
                </>
              )}
            </div>
          )}

          {/* Footer: broker contact */}
          <div className="border-t border-hairline px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm min-w-0">
              {openBoat.brokerName && <span className="font-medium text-ink-900">{openBoat.brokerName}</span>}
              {openBoat.brokerageName && <span className="text-ink-500"> · {openBoat.brokerageName}</span>}
            </div>
            <div className="flex gap-4 text-xs shrink-0">
              {openBoat.brokerPhone && <a href={`tel:${openBoat.brokerPhone}`} onClick={() => trackContact(openBoat.id, "phone")} className="text-accent-700 hover:text-accent-600">{openBoat.brokerPhone}</a>}
              {openBoat.brokerEmail && <a href={`mailto:${openBoat.brokerEmail}`} onClick={() => trackContact(openBoat.id, "email")} className="text-accent-700 hover:text-accent-600">{openBoat.brokerEmail}</a>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
