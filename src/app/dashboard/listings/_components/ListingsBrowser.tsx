"use client";

import { useMemo, useState } from "react";
import ListingRow from "./ListingRow";

type ListingItem = {
  id: string;
  vessel_name: string | null;
  vessel_type: string | null;
  year: number | null;
  length_ft: number | null;
  location: string | null;
  status: string;
  updated_at: string;
  make?: string | null;
  model?: string | null;
  broker_id?: string | null;
  broker_name?: string | null;
  is_shared?: boolean | null;
  slideshow_slug?: string | null;
  slideshow_published?: boolean | null;
};

type StatusFilter = "all" | "active" | "archived";

export type HeroMap = Record<string, { url: string; fit: "fit" | "fill" }>;

export default function ListingsBrowser({
  listings,
  currentUserId,
  coBrokerIds,
  lockedListingIds = [],
  heroes = {},
}: {
  listings: ListingItem[];
  currentUserId: string;
  coBrokerIds: string[];
  lockedListingIds?: string[];
  heroes?: HeroMap;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const coSet = useMemo(() => new Set(coBrokerIds), [coBrokerIds]);
  const lockedSet = useMemo(() => new Set(lockedListingIds), [lockedListingIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listings.filter((l) => {
      if (status === "active" && l.status !== "active") return false;
      if (status === "archived" && l.status === "active") return false;
      if (!q) return true;
      const hay = [
        l.vessel_name, l.make, l.model, l.vessel_type, l.location,
        l.year?.toString(), l.broker_name,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [listings, query, status]);

  const active = filtered.filter((l) => l.status === "active");
  const archived = filtered.filter((l) => l.status !== "active");

  const chip = (key: StatusFilter, label: string) => (
    <button
      onClick={() => setStatus(key)}
      className={`text-xs font-medium px-3 py-2 rounded-ctl border transition-colors duration-fast ease-quiet whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 ${
        status === key ? "bg-ink-950 text-white border-ink-950" : "bg-white text-ink-600 border-hairline-strong hover:border-ink-400 hover:text-ink-900"
      }`}
    >
      {label}
    </button>
  );

  const renderRow = (l: ListingItem) => (
    <ListingRow
      key={l.id}
      listing={l}
      showBroker={l.broker_id !== currentUserId}
      isCoBroker={coSet.has(l.id)}
      locked={lockedSet.has(l.id)}
      heroUrl={heroes[l.id]?.url ?? null}
      heroFit={heroes[l.id]?.fit ?? "fit"}
    />
  );

  return (
    <div>
      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <div className="relative flex-1">
          <svg className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, make, type, location…"
            className="w-full bg-white border border-hairline-strong text-ink-900 placeholder:text-ink-400 rounded-ctl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40 transition-colors duration-fast ease-quiet"
          />
        </div>
        <div className="flex gap-2">
          {chip("all", "All")}
          {chip("active", "Active")}
          {chip("archived", "Archived")}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-12 text-center">
          <p className="text-ink-500 text-sm">No listings match &ldquo;{query}&rdquo;.</p>
        </div>
      ) : status === "active" ? (
        <div className="space-y-3">{active.map(renderRow)}</div>
      ) : status === "archived" ? (
        <div className="space-y-3">{archived.map(renderRow)}</div>
      ) : (
        <>
          {active.length > 0 && (
            <div className="mb-8">
              <h2 className="label-caps mb-3">Active ({active.length})</h2>
              <div className="space-y-3">{active.map(renderRow)}</div>
            </div>
          )}
          {archived.length > 0 && (
            <div>
              <h2 className="label-caps mb-3">Archived / Sold ({archived.length})</h2>
              <div className="space-y-3">{archived.map(renderRow)}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
