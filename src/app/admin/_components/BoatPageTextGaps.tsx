"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Row = { id: string; name: string; sitePage: string | null; hasDescription: boolean; hasLocation: boolean };

// Which boats live on yachtpics.com still lack a description or a location —
// the two things their page's intro and Google description are written from.
// A work list: each row opens that listing's "Website page" block.
export default function BoatPageTextGaps() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetch("/api/admin/site/published-listings")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "Couldn't load the live boats.");
        setRows((d.listings ?? []) as Row[]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the live boats."));
  }, []);

  const noDesc = rows ? rows.filter((r) => !r.hasDescription).length : 0;
  const noLoc = rows ? rows.filter((r) => !r.hasLocation).length : 0;
  const listed = rows ? (showAll ? rows : rows.filter((r) => !r.hasDescription || !r.hasLocation)) : [];

  const badge = (ok: boolean) =>
    ok ? (
      <span className="text-xs text-success-700">✓</span>
    ) : (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-warn-50 border border-warn-200 text-warn-700">Missing</span>
    );

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-ink-900 mb-1">Boat page text</h3>
          <p className="text-ink-500 text-sm">
            {error
              ? error
              : rows === null
                ? "Checking the boats on yachtpics.com…"
                : `${rows.length} live boat${rows.length === 1 ? "" : "s"} · ${noDesc} without a description · ${noLoc} without a location.`}
          </p>
          <p className="text-ink-400 text-xs mt-1">
            A description becomes the page&rsquo;s intro and Google description; the location goes in its specs. Fill them in on each listing&rsquo;s Website page block, then re-publish.
          </p>
        </div>
        {rows && rows.length > 0 && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 bg-white hover:border-ink-400 hover:text-ink-900 text-ink-700 text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong transition-colors duration-fast ease-quiet"
          >
            {open ? "Hide list" : "Show list"}
          </button>
        )}
      </div>

      {open && rows && (
        <div className="mt-4 border-t border-hairline pt-4">
          <label className="inline-flex items-center gap-2 text-xs text-ink-500 mb-3">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show every live boat (not only the ones missing something)
          </label>
          {listed.length === 0 ? (
            <p className="text-sm text-success-700">Every live boat has a description and a location.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="pb-2 pr-4 label-caps">Boat</th>
                    <th className="pb-2 pr-4 label-caps">Website page</th>
                    <th className="pb-2 pr-4 label-caps">Description</th>
                    <th className="pb-2 pr-4 label-caps">Location</th>
                    <th className="pb-2 label-caps" />
                  </tr>
                </thead>
                <tbody>
                  {listed.map((r) => (
                    <tr key={r.id} className="border-t border-hairline">
                      <td className="py-2 pr-4 text-ink-900">{r.name}</td>
                      <td className="py-2 pr-4 text-ink-500">{r.sitePage ?? "—"}</td>
                      <td className="py-2 pr-4">{badge(r.hasDescription)}</td>
                      <td className="py-2 pr-4">{badge(r.hasLocation)}</td>
                      <td className="py-2 text-right">
                        <Link
                          href={`/admin/listings/${r.id}#website-page`}
                          className="text-xs font-medium text-accent-700 hover:text-accent-600 transition-colors duration-fast"
                        >
                          Edit →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
