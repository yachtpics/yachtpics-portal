"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { SiteCard } from "@/lib/brokerSiteServer";
import ShowingModal from "./ShowingModal";

/**
 * The Yachts grid (and, with `sold`, the Recent sales grid). Client side only
 * for the "Request a showing" dialog and — at 10+ boats — three filters.
 */

const LENGTH_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: "u40", label: "Under 40′", min: 0, max: 40 },
  { key: "40", label: "40–60′", min: 40, max: 60 },
  { key: "60", label: "60–80′", min: 60, max: 80 },
  { key: "80", label: "80′ +", min: 80, max: Infinity },
];
const PRICE_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: "u1", label: "Under $1M", min: 0, max: 1_000_000 },
  { key: "1-3", label: "$1M–$3M", min: 1_000_000, max: 3_000_000 },
  { key: "3", label: "$3M +", min: 3_000_000, max: Infinity },
];

const chip = (on: boolean) =>
  `min-h-[40px] px-4 rounded-full border text-sm transition-colors duration-fast ${
    on ? "border-ink-900 bg-ink-900 text-white" : "border-hairline-strong text-ink-700 hover:border-ink-400"
  }`;

export default function YachtGrid({
  cards,
  slug,
  firstName,
  serifClass,
  sold = false,
  showPrices = false,
}: {
  cards: SiteCard[];
  slug: string;
  firstName: string;
  serifClass: string;
  sold?: boolean;
  showPrices?: boolean;
}) {
  const [showing, setShowing] = useState<SiteCard | null>(null);
  const [len, setLen] = useState<string | null>(null);
  const [builder, setBuilder] = useState<string>("");
  const [price, setPrice] = useState<string | null>(null);

  const filterable = !sold && cards.length >= 10;
  const lengthOptions = useMemo(
    () => LENGTH_BUCKETS.filter((b) => cards.some((c) => c.lengthFt != null && c.lengthFt >= b.min && c.lengthFt < b.max)),
    [cards]
  );
  const builders = useMemo(
    () => Array.from(new Set(cards.map((c) => c.builder).filter((b): b is string => !!b))).sort((a, b) => a.localeCompare(b)),
    [cards]
  );
  const priceOptions = useMemo(
    () => (showPrices ? PRICE_BUCKETS.filter((b) => cards.some((c) => c.priceValue != null && c.priceValue >= b.min && c.priceValue < b.max)) : []),
    [cards, showPrices]
  );

  const shown = cards.filter((c) => {
    if (!filterable) return true;
    if (len) {
      const b = LENGTH_BUCKETS.find((x) => x.key === len);
      if (b && !(c.lengthFt != null && c.lengthFt >= b.min && c.lengthFt < b.max)) return false;
    }
    if (builder && c.builder !== builder) return false;
    if (price) {
      const b = PRICE_BUCKETS.find((x) => x.key === price);
      if (b && !(c.priceValue != null && c.priceValue >= b.min && c.priceValue < b.max)) return false;
    }
    return true;
  });

  return (
    <>
      {filterable && (lengthOptions.length > 1 || builders.length > 1 || priceOptions.length > 1) && (
        <div className="mb-8 flex flex-wrap items-center gap-2">
          {lengthOptions.length > 1 &&
            lengthOptions.map((b) => (
              <button key={b.key} type="button" className={chip(len === b.key)} aria-pressed={len === b.key} onClick={() => setLen(len === b.key ? null : b.key)}>
                {b.label}
              </button>
            ))}
          {builders.length > 1 && (
            <select
              aria-label="Builder"
              value={builder}
              onChange={(e) => setBuilder(e.target.value)}
              className="min-h-[40px] px-4 rounded-full border border-hairline-strong bg-white text-sm text-ink-700"
            >
              <option value="">All builders</option>
              {builders.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          {priceOptions.length > 1 &&
            priceOptions.map((b) => (
              <button key={b.key} type="button" className={chip(price === b.key)} aria-pressed={price === b.key} onClick={() => setPrice(price === b.key ? null : b.key)}>
                {b.label}
              </button>
            ))}
          {(len || builder || price) && (
            <button type="button" onClick={() => { setLen(null); setBuilder(""); setPrice(null); }} className="min-h-[40px] px-3 text-sm text-ink-500 underline underline-offset-4 hover:text-ink-900">
              Clear
            </button>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-ink-500 text-[0.9375rem] py-10">No yachts match those filters.</p>
      ) : (
        <ul className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <li key={c.id} className="group flex flex-col">
              <div className="relative">
                <div className="relative aspect-[3/2] overflow-hidden bg-ink-100">
                  {c.photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.photo}
                      alt={c.alt}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-quiet group-hover:scale-[1.025]"
                    />
                  )}
                  {sold && (
                    <span className="absolute left-0 top-5 bg-[var(--site-accent)] text-[var(--site-on-accent)] text-[0.6875rem] font-semibold uppercase tracking-caps-wide pl-4 pr-5 py-1.5">
                      Sold
                    </span>
                  )}
                  {!sold && c.hasVideo && (
                    <span className="absolute right-3 bottom-3 flex gap-1.5">
                      <span className="bg-white/90 text-ink-900 text-[0.625rem] font-semibold uppercase tracking-caps px-2 py-1">Video</span>
                    </span>
                  )}
                </div>
                <div className="pt-5">
                  <h3 className={`${serifClass} text-[1.625rem] leading-tight text-ink-950`}>
                    {c.href ? (
                      <Link href={c.href} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:underline">
                        {c.name}
                      </Link>
                    ) : (
                      c.name
                    )}
                  </h3>
                  {c.specs && <p className="text-ink-600 text-sm mt-1.5">{c.specs}</p>}
                  {sold ? (
                    c.soldLabel && <p className="text-ink-500 text-sm mt-1">Sold {c.soldLabel}</p>
                  ) : (
                    <p className="mt-2 flex flex-wrap items-baseline gap-x-3 text-sm">
                      <span className="text-ink-900 font-semibold tabular-nums">{c.price ?? "Price on request"}</span>
                      {c.location && <span className="text-ink-500">{c.location}</span>}
                    </p>
                  )}
                </div>
              </div>
              {!sold && (
                <div className="pt-4 mt-auto">
                  <button
                    type="button"
                    onClick={() => setShowing(c)}
                    className="relative z-10 min-h-[44px] text-sm font-semibold text-ink-900 border-b border-[var(--site-accent)] hover:text-ink-600 transition-colors duration-fast"
                  >
                    Request a showing
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {showing && (
        <ShowingModal
          slug={slug}
          firstName={firstName}
          listingId={showing.id}
          boatLabel={showing.label}
          serifClass={serifClass}
          onClose={() => setShowing(null)}
        />
      )}
    </>
  );
}
