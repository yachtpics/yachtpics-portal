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
};

type StatusFilter = "all" | "active" | "sold" | "archived";

export default function AdminListingsBrowser({ listings }: { listings: Row[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

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
      className={`text-xs font-medium px-3 py-2 rounded-lg border transition-colors whitespace-nowrap ${
        status === key ? "bg-[#050b14] text-white border-[#050b14]" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <div className="relative flex-1">
          <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vessel, make, broker, location…"
            className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a843] transition-colors"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {chip("all", "All")}
          {chip("active", "Active")}
          {chip("sold", "Sold")}
          {chip("archived", "Archived")}
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-3">{filtered.length} of {listings.length} listings</p>

      {filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-12 text-center">
          <p className="text-gray-400 text-sm">No listings match your search.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Vessel</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Broker</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Location</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((listing) => (
                <tr key={listing.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{listing.vessel_name ?? "Untitled"}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {[listing.year, listing.vessel_type, listing.length_ft ? `${listing.length_ft}′` : null].filter(Boolean).join(" · ")}
                    </p>
                  </td>
                  <td className="px-6 py-4 text-gray-500 hidden sm:table-cell">{listing.broker_name ?? "—"}</td>
                  <td className="px-6 py-4 text-gray-500 hidden md:table-cell">{listing.location ?? "—"}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      listing.status === "active" ? "bg-green-50 text-green-700"
                      : listing.status === "sold" ? "bg-blue-50 text-blue-700"
                      : "bg-gray-100 text-gray-500"
                    }`}>
                      {listing.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-4">
                      <DeleteListingButton
                        listingId={listing.id}
                        vesselName={listing.vessel_name ?? null}
                        brokerId={listing.broker_id ?? ""}
                        redirectTo="/admin/listings"
                      />
                      <Link href={`/admin/listings/${listing.id}`} className="text-[#c49a35] hover:text-[#b08c2a] text-xs font-medium transition-colors">
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
