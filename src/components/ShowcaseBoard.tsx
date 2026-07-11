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
  const [idx, setIdx] = useState(0);
  const [touchX, setTouchX] = useState<number | null>(null);

  const openBoat = boats.find((b) => b.id === openId) ?? null;

  const open = useCallback(async (id: string) => {
    setOpenId(id);
    setPhotos([]);
    setIdx(0);
    setLoading(true);
    try {
      const res = await fetch(`/api/showcase/${id}/photos`);
      const data = await res.json();
      setPhotos(Array.isArray(data.photos) ? data.photos : []);
    } catch {
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const close = useCallback(() => { setOpenId(null); setPhotos([]); }, []);
  const next = useCallback(() => setIdx((i) => (photos.length ? (i + 1) % photos.length : 0)), [photos.length]);
  const prev = useCallback(() => setIdx((i) => (photos.length ? (i - 1 + photos.length) % photos.length : 0)), [photos.length]);

  // Keyboard nav + lock background scroll while open.
  useEffect(() => {
    if (!openId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [openId, close, next, prev]);

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
                  {b.brokerPhone && <a href={`tel:${b.brokerPhone}`} className="text-accent-700 hover:text-accent-600 transition-colors duration-fast">{b.brokerPhone}</a>}
                  {b.brokerEmail && <a href={`mailto:${b.brokerEmail}`} className="text-accent-700 hover:text-accent-600 transition-colors duration-fast truncate">{b.brokerEmail}</a>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {openBoat && (
        <div className="fixed inset-0 z-50 bg-ink-50 flex flex-col" role="dialog" aria-modal="true">
          <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-hairline gap-4">
            <div className="min-w-0">
              <p className="text-ink-900 font-semibold text-sm truncate">{openBoat.vesselName}</p>
              <p className="label-caps text-ink-500">
                {loading ? "Loading…" : photos.length ? `${idx + 1} / ${photos.length}` : "No photos"}
              </p>
            </div>
            <button
              onClick={close}
              aria-label="Close"
              className="shrink-0 flex h-11 w-11 items-center justify-center rounded-full border border-hairline bg-white text-ink-700 text-xl leading-none shadow-elev-1 hover:bg-ink-50 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              ✕
            </button>
          </div>

          <div
            className="flex-1 relative flex items-center justify-center p-2 sm:p-5 select-none"
            onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (touchX === null) return;
              const diff = touchX - e.changedTouches[0].clientX;
              if (Math.abs(diff) > 50) diff > 0 ? next() : prev();
              setTouchX(null);
            }}
          >
            {loading ? (
              <p className="label-caps text-ink-400">Loading photos…</p>
            ) : photos.length ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photos[idx]} alt="" className="max-h-full max-w-full object-contain rounded-[2px] shadow-print" />
            ) : (
              <p className="text-ink-500 text-sm">No additional photos for this boat.</p>
            )}

            {photos.length > 1 && (
              <>
                <button onClick={prev} aria-label="Previous photo" className={`${arrow} left-3`}>‹</button>
                <button onClick={next} aria-label="Next photo" className={`${arrow} right-3`}>›</button>
              </>
            )}
          </div>

          <div className="border-t border-hairline px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm min-w-0">
              {openBoat.brokerName && <span className="font-medium text-ink-900">{openBoat.brokerName}</span>}
              {openBoat.brokerageName && <span className="text-ink-500"> · {openBoat.brokerageName}</span>}
            </div>
            <div className="flex gap-4 text-xs shrink-0">
              {openBoat.brokerPhone && <a href={`tel:${openBoat.brokerPhone}`} className="text-accent-700 hover:text-accent-600">{openBoat.brokerPhone}</a>}
              {openBoat.brokerEmail && <a href={`mailto:${openBoat.brokerEmail}`} className="text-accent-700 hover:text-accent-600">{openBoat.brokerEmail}</a>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
