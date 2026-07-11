"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export type FeaturedBoat = {
  id: string;
  vesselName: string;
  subtitle: string;
  location: string;
  heroUrl: string | null;
  brokerName: string | null;
};

// A slim, self-rotating band on the dashboard. Cycles through the current
// Recently Photographed set so every broker sees fresh work on login; one tap
// opens the full showcase. Deliberately quiet — it never blocks the work below.
export default function FeaturedStrip({ boats }: { boats: FeaturedBoat[] }) {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    if (boats.length <= 1) return;
    const t = setInterval(() => {
      setShown(false);
      const swap = setTimeout(() => {
        setI((x) => (x + 1) % boats.length);
        setShown(true);
      }, 240);
      return () => clearTimeout(swap);
    }, 5000);
    return () => clearInterval(t);
  }, [boats.length]);

  if (boats.length === 0) return null;
  const b = boats[i];
  const fade = `transition-opacity duration-slow ease-quiet ${shown ? "opacity-100" : "opacity-0"}`;

  return (
    <Link
      href="/dashboard/showcase"
      className="group block mb-6 bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden transition-all duration-base ease-quiet hover:shadow-elev-2 hover:border-hairline-strong"
    >
      <div className="flex items-stretch">
        <div className="relative w-32 sm:w-48 shrink-0 bg-ink-100 overflow-hidden">
          {b.heroUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.heroUrl} alt={b.vesselName} className={`h-full w-full object-cover ${fade}`} />
          ) : (
            <span className="flex h-full w-full items-center justify-center label-caps text-ink-300">No photo</span>
          )}
        </div>

        <div className="flex-1 min-w-0 px-5 py-4 flex flex-col justify-center">
          <p className="label-caps text-accent-700">Recently Photographed</p>
          <div className={fade}>
            <p className="text-ink-900 font-semibold text-base sm:text-lg mt-1 truncate">{b.vesselName}</p>
            <p className="text-ink-500 text-xs sm:text-sm mt-0.5 truncate">
              {[b.subtitle, b.location].filter(Boolean).join(" · ")}
            </p>
            {b.brokerName && <p className="text-ink-400 text-xs mt-0.5 truncate">{b.brokerName}</p>}
          </div>
          <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent-700 transition-colors duration-fast group-hover:text-accent-600">
            See all recently photographed <span aria-hidden>&rarr;</span>
          </span>
        </div>

        {boats.length > 1 && (
          <div className="hidden sm:flex flex-col justify-center gap-1.5 pr-4">
            {boats.map((_, n) => (
              <span key={n} aria-hidden className={`h-1.5 w-1.5 rounded-full transition-colors duration-base ${n === i ? "bg-accent-500" : "bg-ink-200"}`} />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
