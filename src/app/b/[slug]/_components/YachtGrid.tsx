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
    on ? "border-[var(--site-ink)] bg-[var(--site-ink)] text-[var(--site-bg)]" : "border-[var(--site-field-border)] text-[var(--site-ink)] hover:border-[var(--site-muted)]"
  }`;

export default function YachtGrid({
  cards,
  slug,
  firstName,
  serifClass,
  sold = false,
  showPrices = false,
  variant = "grid",
}: {
  cards: SiteCard[];
  slug: string;
  firstName: string;
  serifClass: string;
  sold?: boolean;
  showPrices?: boolean;
  /** grid = Classic (3 across), rows = Editorial (large alternating rows), tiles = Showroom (tall image cards, 2 across). */
  variant?: "grid" | "rows" | "tiles";
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
              className="min-h-[40px] px-4 rounded-full border border-[var(--site-field-border)] bg-[var(--site-bg)] text-sm text-[var(--site-ink)]"
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
            <button type="button" onClick={() => { setLen(null); setBuilder(""); setPrice(null); }} className="min-h-[40px] px-3 text-sm text-[var(--site-muted)] underline underline-offset-4 hover:text-[var(--site-ink)]">
              Clear
            </button>
          )}
        </div>
      )}

      {shown.length > 0 && variant === "rows" && (
        <ul className="space-y-20 sm:space-y-28">
          {shown.map((c, i) => (
            <li key={c.id} className="group grid gap-8 md:grid-cols-12 md:items-center">
              <div className={`relative md:col-span-7 ${i % 2 === 1 ? "md:order-2" : ""}`}>
                <div className="relative aspect-[4/3] overflow-hidden bg-[var(--site-surface)]">
                  {c.photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.photo} alt={c.alt} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-quiet group-hover:scale-[1.02]" />
                  )}
                  {sold && (
                    <span className="absolute left-0 top-5 bg-[var(--site-accent)] text-[var(--site-on-accent)] text-[0.6875rem] font-semibold uppercase tracking-caps-wide pl-4 pr-5 py-1.5">Sold</span>
                  )}
                  {!sold && c.hasVideo && (
                    <span className="absolute right-3 bottom-3 bg-black/55 text-white backdrop-blur-sm text-[0.625rem] font-semibold uppercase tracking-caps px-2 py-1">Video</span>
                  )}
                  {c.href && <Link href={c.href} aria-label={c.name} tabIndex={-1} className="absolute inset-0" />}
                </div>
              </div>
              <div className={`md:col-span-5 ${i % 2 === 1 ? "md:order-1 md:pr-6" : "md:pl-6"}`}>
                <p className="text-[0.6875rem] font-semibold uppercase tracking-caps-wide text-[var(--site-muted)]">{String(i + 1).padStart(2, "0")}</p>
                <h3 className={`${serifClass} mt-3 text-[2rem] sm:text-[2.5rem] leading-[1.05] text-[var(--site-ink)]`}>
                  {c.href ? <Link href={c.href} className="hover:opacity-80 transition-opacity">{c.name}</Link> : c.name}
                </h3>
                {c.specs && <p className="text-[var(--site-muted)] text-[0.9375rem] mt-3">{c.specs}</p>}
                {sold ? (
                  c.soldLabel && <p className="text-[var(--site-muted)] text-[0.9375rem] mt-2">Sold {c.soldLabel}</p>
                ) : (
                  <>
                    <p className="mt-3 flex flex-wrap items-baseline gap-x-3 text-[0.9375rem]">
                      <span className="text-[var(--site-ink)] font-semibold tabular-nums">{c.price ?? "Price on request"}</span>
                      {c.location && <span className="text-[var(--site-muted)]">{c.location}</span>}
                    </p>
                    <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2">
                      <button type="button" onClick={() => setShowing(c)} className="min-h-[48px] px-6 bg-[var(--site-accent)] text-[var(--site-on-accent)] text-sm font-semibold tracking-wide hover:opacity-90 transition-opacity">
                        Request a showing
                      </button>
                      {c.href && (
                        <Link href={c.href} className="inline-flex items-center min-h-[48px] text-sm font-semibold text-[var(--site-ink)] border-b border-[var(--site-rule)] hover:border-[var(--site-ink)]">
                          See her photographs →
                        </Link>
                      )}
                    </div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {shown.length > 0 && variant === "tiles" && (
        <ul className="grid gap-4 sm:gap-6 md:grid-cols-2">
          {shown.map((c) => (
            <li key={c.id} className="group relative aspect-[4/5] sm:aspect-[5/6] overflow-hidden bg-[var(--site-surface)]">
              {c.photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.photo} alt={c.alt} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition-transform duration-1000 ease-quiet group-hover:scale-[1.03]" />
              )}
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              {sold && (
                <span className="absolute left-0 top-6 bg-[var(--site-accent)] text-[var(--site-on-accent)] text-[0.6875rem] font-semibold uppercase tracking-caps-wide pl-4 pr-5 py-1.5">Sold</span>
              )}
              {!sold && c.hasVideo && (
                <span className="absolute right-4 top-4 bg-black/55 text-white backdrop-blur-sm text-[0.625rem] font-semibold uppercase tracking-caps px-2 py-1">Video</span>
              )}
              <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8 text-white">
                <h3 className={`${serifClass} text-[2rem] sm:text-[2.375rem] leading-[1.05]`}>
                  {c.href ? (
                    <Link href={c.href} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:underline">{c.name}</Link>
                  ) : (
                    c.name
                  )}
                </h3>
                {c.specs && <p className="text-white/75 text-sm mt-2">{c.specs}</p>}
                {sold ? (
                  c.soldLabel && <p className="text-white/70 text-sm mt-1">Sold {c.soldLabel}</p>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm">
                      <span className="font-semibold tabular-nums">{c.price ?? "Price on request"}</span>
                      {c.location && <span className="text-white/70"> · {c.location}</span>}
                    </p>
                    <button type="button" onClick={() => setShowing(c)} className="relative z-10 min-h-[44px] text-sm font-semibold border-b border-white/60 hover:border-white">
                      Request a showing
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {(shown.length === 0 || variant === "grid") && (
      shown.length === 0 ? (
        <p className="text-[var(--site-muted)] text-[0.9375rem] py-10">No yachts match those filters.</p>
      ) : (
        <ul className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <li key={c.id} className="group flex flex-col">
              <div className="relative">
                <div className="relative aspect-[3/2] overflow-hidden bg-[var(--site-surface)]">
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
                      <span className="bg-black/55 text-white backdrop-blur-sm text-[0.625rem] font-semibold uppercase tracking-caps px-2 py-1">Video</span>
                    </span>
                  )}
                </div>
                <div className="pt-5">
                  <h3 className={`${serifClass} text-[1.625rem] leading-tight text-[var(--site-ink)]`}>
                    {c.href ? (
                      <Link href={c.href} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:underline">
                        {c.name}
                      </Link>
                    ) : (
                      c.name
                    )}
                  </h3>
                  {c.specs && <p className="text-[var(--site-muted)] text-sm mt-1.5">{c.specs}</p>}
                  {sold ? (
                    c.soldLabel && <p className="text-[var(--site-muted)] text-sm mt-1">Sold {c.soldLabel}</p>
                  ) : (
                    <p className="mt-2 flex flex-wrap items-baseline gap-x-3 text-sm">
                      <span className="text-[var(--site-ink)] font-semibold tabular-nums">{c.price ?? "Price on request"}</span>
                      {c.location && <span className="text-[var(--site-muted)]">{c.location}</span>}
                    </p>
                  )}
                </div>
              </div>
              {!sold && (
                <div className="pt-4 mt-auto">
                  <button
                    type="button"
                    onClick={() => setShowing(c)}
                    className="relative z-10 min-h-[44px] text-sm font-semibold text-[var(--site-ink)] border-b border-[var(--site-accent)] hover:text-[var(--site-muted)] transition-colors duration-fast"
                  >
                    Request a showing
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ))}

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
