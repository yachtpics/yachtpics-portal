"use client";

import { useState } from "react";
import Link from "next/link";

type Listing = {
  id: string;
  vessel_name: string | null;
  vessel_type: string | null;
  year: number | null;
  length_ft: string | null;
  location: string | null;
  status: string | null;
  publish_to_site: boolean | null;
  site_page: string | null;
  showcase_opt_out: boolean | null;
};

type SitePage = { label: string; filename: string };

// The broker page's Listings block, upgraded so a whole fleet can be pushed to
// yachtpics.com without opening each boat. One shared "Website page" picker at
// the top (all a broker's boats land on the same brokerage page), then a
// per-row On/Off toggle. Each toggle sets the boat's site_page to the chosen
// page (if needed) and hits the same publish-site pipeline the listing page uses.
export default function BrokerListingsPublisher({
  listings,
  sitePages,
}: {
  listings: Listing[];
  sitePages: SitePage[];
}) {
  const [pages, setPages] = useState<SitePage[]>(sitePages);
  // Default the picker to whatever page these boats already point at, if any.
  const [target, setTarget] = useState<string>(
    listings.find((l) => l.site_page)?.site_page ?? ""
  );
  const [rows, setRows] = useState(
    listings.map((l) => ({ ...l, onSite: !!l.publish_to_site }))
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  function flash(text: string, ms = 5000) {
    setMsg(text);
    setTimeout(() => setMsg(""), ms);
  }

  async function addBrokeragePage() {
    const label = window
      .prompt("New brokerage name (as it should appear on yachtpics.com):")
      ?.trim();
    if (!label) return;
    try {
      const res = await fetch(`/api/admin/site-pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setPages((prev) =>
        [...prev, { label: data.label, filename: data.filename }].sort((a, b) =>
          a.label.localeCompare(b.label)
        )
      );
      setTarget(data.filename);
      flash(`Added "${data.label}" — it's now selected.`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't add the brokerage page.", 6000);
    }
  }

  async function toggle(row: (typeof rows)[number]) {
    if (busyId) return;
    const next = !row.onSite;

    if (next && !target) {
      flash("Pick a website page above first.", 3500);
      return;
    }

    setBusyId(row.id);
    try {
      // Point the boat at the chosen page before publishing (the publisher
      // refuses to build without one).
      if (next && row.site_page !== target) {
        const r1 = await fetch(`/api/admin/listings/${row.id}/site-page`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sitePage: target }),
        });
        if (!r1.ok) throw new Error("Couldn't set the website page.");
      }

      const res = await fetch(`/api/admin/listings/${row.id}/publish-site`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");

      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, onSite: next, site_page: next ? target : r.site_page }
            : r
        )
      );
      const name = row.vessel_name ?? "Boat";
      if (!next) flash(`${name} removed from the website.`);
      else if (data.previewOnly) flash(`${name}: generated — ${data.reason}`, 6000);
      else flash(`${name} published to yachtpics.com.`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Something went wrong.", 6000);
    } finally {
      setBusyId(null);
    }
  }

  const selectedLabel = pages.find((p) => p.filename === target)?.label;

  return (
    <div>
      {/* Shared page picker */}
      <div className="px-6 py-3 border-b border-hairline bg-ink-50 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-ink-600">Website page:</span>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="text-sm border border-hairline-strong rounded-ctl px-2.5 py-1.5 bg-white text-ink-900 max-w-[280px]"
        >
          <option value="">— Choose a brokerage page —</option>
          {pages.map((p) => (
            <option key={p.filename} value={p.filename}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          onClick={addBrokeragePage}
          className="text-xs font-medium text-accent-700 hover:text-accent-800 transition-colors duration-fast ease-quiet"
        >
          + New brokerage
        </button>
        <span className="text-xs text-ink-400">
          Boats you switch on publish to {selectedLabel ? `“${selectedLabel}”` : "this page"}.
        </span>
      </div>

      {msg && (
        <div className="px-6 py-2.5 bg-accent-50 border-b border-accent-200 text-xs text-accent-800">
          {msg}
        </div>
      )}

      <ul className="divide-y divide-hairline">
        {rows.map((listing) => {
          const active = listing.status === "active";
          const pocket = !!listing.showcase_opt_out;
          const busy = busyId === listing.id;
          return (
            <li
              key={listing.id}
              className="px-6 py-4 flex items-center justify-between hover:bg-ink-50 transition-colors duration-fast ease-quiet"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900 truncate">
                  {listing.vessel_name ?? "Untitled"}
                </p>
                <p className="text-xs text-ink-500 mt-0.5">
                  {[
                    listing.year,
                    listing.vessel_type,
                    listing.length_ft ? `${listing.length_ft}′` : null,
                    listing.location,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                    listing.status === "active"
                      ? "bg-success-50 text-success-700 border-success-200"
                      : listing.status === "sold"
                      ? "bg-info-50 text-info-700 border-info-200"
                      : "bg-ink-100 text-ink-600 border-hairline"
                  }`}
                >
                  {listing.status}
                </span>

                {/* Website toggle — only meaningful for active, non-pocket boats. */}
                {pocket ? (
                  <span
                    className="text-[11px] text-ink-400"
                    title="The broker marked this a pocket listing — it can't go on the website."
                  >
                    Pocket
                  </span>
                ) : active ? (
                  <button
                    onClick={() => toggle(listing)}
                    disabled={busy}
                    title={
                      listing.onSite
                        ? "On the website — click to remove"
                        : "Publish this boat to the website"
                    }
                    className={`inline-flex items-center gap-2 text-xs font-medium pl-1.5 pr-3 py-1.5 rounded-full border transition-colors duration-fast ease-quiet disabled:opacity-50 ${
                      listing.onSite
                        ? "border-accent-500 bg-accent-50 text-accent-700"
                        : "border-hairline-strong bg-white text-ink-500 hover:border-accent-500"
                    }`}
                  >
                    <span
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-fast ease-quiet ${
                        listing.onSite ? "bg-accent-500" : "bg-ink-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                          listing.onSite ? "translate-x-3.5" : "translate-x-0.5"
                        }`}
                      />
                    </span>
                    {busy ? "Working…" : listing.onSite ? "On website" : "Add to website"}
                  </button>
                ) : null}

                <Link
                  href={`/admin/listings/${listing.id}?from=broker`}
                  className="text-accent-700 hover:text-accent-800 text-xs font-medium transition-colors duration-fast ease-quiet"
                >
                  Manage →
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
