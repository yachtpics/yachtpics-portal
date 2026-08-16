"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import DeleteListingButton from "../[id]/_components/DeleteListingButton";

type Row = {
  id: string;
  vessel_name: string | null;
  vessel_type: string | null;
  year: number | null;
  length_ft: number | null;
  location: string | null;
  status: string;
  broker_id: string | null;
  broker_name: string | null;
  make: string | null;
  model: string | null;
  in_showcase: boolean;
  showcase_opt_out: boolean;
};

type StatusFilter = "all" | "active" | "sold" | "archived";

export default function AdminListingsBrowser({ listings }: { listings: Row[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [showcase, setShowcase] = useState<Record<string, boolean>>(
    () => Object.fromEntries(listings.map((l) => [l.id, l.in_showcase]))
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleShowcase(id: string) {
    const next = !showcase[id];
    setBusyId(id);
    setShowcase((s) => ({ ...s, [id]: next })); // optimistic
    try {
      const res = await fetch(`/api/admin/listings/${id}/showcase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ show: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setShowcase((s) => ({ ...s, [id]: !next })); // revert
    } finally {
      setBusyId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listings.filter((l) => {
      if (status !== "all" && l.status !== status) return false;
      if (!q) return true;
      const hay = [l.vessel_name, l.make, l.model, l.vessel_type, l.location, l.year?.toString(), l.broker_name]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [listings, query, status]);

  const chip = (key: StatusFilter, label: string) => (
    <button
      onClick={() => setStatus(key)}
      className={`text-xs font-medium px-3 py-2 rounded-ctl border transition-colors duration-fast ease-quiet whitespace-nowrap ${
        status === key ? "bg-ink-950 text-white border-ink-950" : "bg-white text-ink-600 border-hairline-strong hover:border-ink-400"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <div className="relative flex-1">
          <svg className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vessel, make, broker, location…"
            className="w-full bg-white border border-hairline-strong rounded-ctl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors duration-fast ease-quiet"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {chip("all", "All")}
          {chip("active", "Active")}
          {chip("sold", "Sold")}
          {chip("archived", "Archived")}
        </div>
      </div>

      <p className="text-xs text-ink-500 mb-3 tabular-nums">{filtered.length} of {listings.length} listings</p>

      {filtered.length === 0 ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-12 text-center">
          <p className="text-ink-400 text-sm">No listings match your search.</p>
        </div>
      ) : (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="px-6 py-3 label-caps">Vessel</th>
                <th className="px-6 py-3 label-caps hidden sm:table-cell">Broker</th>
                <th className="px-6 py-3 label-caps hidden md:table-cell">Location</th>
                <th className="px-6 py-3 label-caps">Status</th>
                <th className="px-6 py-3 label-caps">Showcase</th>
                <th className="px-6 py-3 label-caps sticky right-0 bg-white"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {filtered.map((listing) => (
                <tr key={listing.id} className="hover:bg-ink-50 transition-colors duration-fast ease-quiet">
                  <td className="px-6 py-4">
                    <p className="font-medium text-ink-900">{listing.vessel_name ?? "Untitled"}</p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      {[listing.year, listing.vessel_type, listing.length_ft ? `${listing.length_ft}′` : null].filter(Boolean).join(" · ")}
                    </p>
                  </td>
                  <td className="px-6 py-4 text-ink-500 hidden sm:table-cell">{listing.broker_name ?? "—"}</td>
                  <td className="px-6 py-4 text-ink-500 hidden md:table-cell">{listing.location ?? "—"}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                      listing.status === "active" ? "bg-success-50 text-success-700 border-success-200"
                      : listing.status === "sold" ? "bg-info-50 text-info-700 border-info-200"
                      : "bg-ink-100 text-ink-600 border-hairline"
                    }`}>
                      {listing.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      onClick={() => toggleShowcase(listing.id)}
                      disabled={busyId === listing.id}
                      aria-pressed={showcase[listing.id]}
                      title={showcase[listing.id] ? "In Recently Photographed" : "Add to Recently Photographed"}
                      className={`inline-flex items-center gap-2 text-xs font-medium pl-1.5 pr-2.5 py-1 rounded-full border transition-colors duration-fast ease-quiet disabled:opacity-50 ${
                        showcase[listing.id]
                          ? "border-accent-500 bg-accent-50 text-accent-700"
                          : "border-hairline-strong bg-white text-ink-500 hover:border-accent-500"
                      }`}
                    >
                      <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-fast ease-quiet ${showcase[listing.id] ? "bg-accent-500" : "bg-ink-300"}`}>
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${showcase[listing.id] ? "translate-x-3.5" : "translate-x-0.5"}`} />
                      </span>
                      {showcase[listing.id] ? "Featured" : "Feature"}
                    </button>
                    {listing.showcase_opt_out && (
                      <span className="block text-[11px] text-warn-700 mt-1">Broker: pocket listing</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right sticky right-0 bg-white whitespace-nowrap shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.08)]">
                    <div className="flex items-center justify-end gap-4">
                      <DeleteListingButton
                        listingId={listing.id}
                        vesselName={listing.vessel_name ?? null}
                        brokerId={listing.broker_id ?? ""}
                        redirectTo="/admin/listings"
                      />
                      <Link href={`/admin/listings/${listing.id}`} className="text-accent-700 hover:text-accent-800 text-xs font-medium transition-colors duration-fast ease-quiet">
                        Manage →
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
