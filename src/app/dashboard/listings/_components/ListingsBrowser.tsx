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

export default function ListingsBrowser({
  listings,
  currentUserId,
  coBrokerIds,
}: {
  listings: ListingItem[];
  currentUserId: string;
  coBrokerIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const coSet = useMemo(() => new Set(coBrokerIds), [coBrokerIds]);

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
      className={`text-xs font-medium px-3 py-2 rounded-lg border transition-colors whitespace-nowrap ${
        status === key ? "bg-[#050b14] text-white border-[#050b14]" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
      }`}
    >
      {label}
    </button>
  );

  const renderRow = (l: ListingItem) => (
    <ListingRow key={l.id} listing={l} showBroker={l.broker_id !== currentUserId} isCoBroker={coSet.has(l.id)} />
  );

  return (
    <div>
      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <div className="relative flex-1">
          <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, make, type, location…"
            className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a843] transition-colors"
          />
        </div>
        <div className="flex gap-2">
          {chip("all", "All")}
          {chip("active", "Active")}
          {chip("archived", "Archived")}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-12 text-center">
          <p className="text-gray-400 text-sm">No listings match &ldquo;{query}&rdquo;.</p>
        </div>
      ) : status === "active" ? (
        <div className="space-y-3">{active.map(renderRow)}</div>
      ) : status === "archived" ? (
        <div className="space-y-3">{archived.map(renderRow)}</div>
      ) : (
        <>
          {active.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Active ({active.length})</h2>
              <div className="space-y-3">{active.map(renderRow)}</div>
            </div>
          )}
          {archived.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Archived / Sold ({archived.length})</h2>
              <div className="space-y-3">{archived.map(renderRow)}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
