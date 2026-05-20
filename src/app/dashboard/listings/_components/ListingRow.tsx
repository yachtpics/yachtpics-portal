"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

type Listing = {
  id: string;
  vessel_name: string | null;
  vessel_type: string | null;
  year: number | null;
  length_ft: number | null;
  location: string | null;
  status: string;
  updated_at: string;
  broker_name?: string | null;
};

const STATUS_OPTIONS = ["active", "archived", "sold"] as const;

const statusStyle: Record<string, string> = {
  active:   "bg-green-50 text-green-700",
  sold:     "bg-blue-50 text-blue-700",
  archived: "bg-gray-100 text-gray-500",
};

export default function ListingRow({ listing, showBroker }: { listing: Listing; showBroker?: boolean }) {
  const [status, setStatus] = useState(listing.status);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updated = new Date(listing.updated_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function changeStatus(newStatus: string) {
    if (newStatus === status) { setOpen(false); return; }
    setSaving(true);
    setOpen(false);
    setStatus(newStatus); // optimistic
    try {
      await fetch(`/api/listings/${listing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch {
      setStatus(status); // revert on failure
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-6 py-4 flex items-center justify-between hover:border-[#d4a843] transition-colors">
      {/* Left — link to the listing */}
      <Link href={`/dashboard/listings/${listing.id}`} className="flex-1 min-w-0 pr-4">
        <p className="text-sm font-semibold text-gray-900">
          {listing.vessel_name ?? "Untitled vessel"}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          {[
            listing.year,
            listing.vessel_type,
            listing.length_ft ? `${listing.length_ft}′` : null,
            listing.location,
          ].filter(Boolean).join(" · ")}
        </p>
        {showBroker && listing.broker_name && (
          <p className="text-xs text-[#c49a35] mt-1">{listing.broker_name}</p>
        )}
      </Link>

      {/* Right — updated date + status dropdown */}
      <div className="flex items-center gap-4 shrink-0">
        <p className="text-xs text-gray-400 hidden sm:block">Updated {updated}</p>

        {/* Status badge — click to open picker */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
            disabled={saving}
            className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors cursor-pointer hover:opacity-80 disabled:opacity-50 ${statusStyle[status] ?? "bg-gray-100 text-gray-500"}`}
          >
            {saving ? "Saving…" : status}
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-1.5 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[110px]">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={(e) => { e.preventDefault(); changeStatus(s); }}
                  className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-gray-50 transition-colors ${s === status ? "text-[#c49a35]" : "text-gray-700"}`}
                >
                  {s === status ? `✓ ${s}` : s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
