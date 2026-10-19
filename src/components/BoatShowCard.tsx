"use client";

import { useEffect, useState } from "react";
import {
  showDatesLabel, SHOW_LOCATION_MAX, SHOW_NOTE_MAX,
  type BoatShow, type ShowEntry,
} from "@/lib/boatShows";

/**
 * "Boat shows" card on a listing (broker listing page + admin listing page).
 * Only renders while an active show hasn't ended. Tick "At FLIBS 2026" to mark
 * the boat (saved at once), add the dock / slip and an optional note (Save),
 * and download the dock card PDF. Reads and writes /api/listings/[id]/show;
 * the page's own banner reports success / failure through `onMessage`.
 */

type Draft = { location: string; note: string };

export default function BoatShowCard({
  listingId,
  onMessage,
  className = "mb-5",
}: {
  listingId: string;
  onMessage: (text: string, kind: "success" | "error") => void;
  className?: string;
}) {
  const [shows, setShows] = useState<BoatShow[]>([]);
  const [entries, setEntries] = useState<Record<string, ShowEntry>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [canEdit, setCanEdit] = useState(false);
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [size, setSize] = useState<"5x7" | "letter">("5x7");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/listings/${listingId}/show`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { shows: BoatShow[]; entries: ShowEntry[]; canEdit: boolean; slideshowPublished: boolean } | null) => {
        if (cancelled || !d) return;
        const byShow: Record<string, ShowEntry> = {};
        const nextDrafts: Record<string, Draft> = {};
        d.entries.forEach((e) => { byShow[e.show_key] = e; });
        d.shows.forEach((s) => {
          const e = byShow[s.key];
          nextDrafts[s.key] = { location: e?.location ?? "", note: e?.note ?? "" };
        });
        setShows(d.shows);
        setEntries(byShow);
        setDrafts(nextDrafts);
        setCanEdit(d.canEdit);
        setPublished(d.slideshowPublished);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [listingId]);

  if (shows.length === 0) return null;

  async function save(show: BoatShow, draft: Draft, confirmText: string) {
    setBusy(show.key);
    try {
      const res = await fetch(`/api/listings/${listingId}/show`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showKey: show.key, location: draft.location, note: draft.note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.entry) throw new Error(data.error ?? "Couldn't save. Please try again.");
      const entry = data.entry as ShowEntry;
      setEntries((prev) => ({ ...prev, [show.key]: entry }));
      setDrafts((prev) => ({ ...prev, [show.key]: { location: entry.location ?? "", note: entry.note ?? "" } }));
      onMessage(confirmText, "success");
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Couldn't save. Please try again.", "error");
    } finally {
      setBusy(null);
    }
  }

  async function unmark(show: BoatShow) {
    setBusy(show.key);
    try {
      const res = await fetch(`/api/listings/${listingId}/show?show=${encodeURIComponent(show.key)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't remove it. Please try again.");
      setEntries((prev) => {
        const next = { ...prev };
        delete next[show.key];
        return next;
      });
      setDrafts((prev) => ({ ...prev, [show.key]: { location: "", note: "" } }));
      onMessage(`No longer marked for ${show.short_name}.`, "success");
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Couldn't remove it. Please try again.", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`${className} px-4 py-3.5 rounded-lg bg-white border border-hairline`}>
      <p className="label-caps text-ink-500">Boat shows</p>
      <div className="mt-2 space-y-4">
        {shows.map((show) => {
          const entry = entries[show.key];
          const draft = drafts[show.key] ?? { location: "", note: "" };
          const marked = !!entry;
          const dirty = marked && ((entry.location ?? "") !== draft.location.trim() || (entry.note ?? "") !== draft.note.trim());
          const working = busy === show.key;
          const cardHref = `/api/listings/${listingId}/show-card?show=${encodeURIComponent(show.key)}&size=${size}`;
          return (
            <div key={show.key}>
              <label className={`flex items-start gap-3 ${canEdit ? "cursor-pointer" : ""}`}>
                <input
                  type="checkbox"
                  checked={marked}
                  disabled={!canEdit || working}
                  onChange={() => (marked ? unmark(show) : save(show, draft, `Marked for ${show.short_name}. Add her dock or slip when you have it.`))}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-hairline-strong text-accent-600 focus:ring-accent-500 disabled:opacity-50"
                />
                <span className="text-sm text-ink-700">
                  <span className="font-medium text-ink-900">At {show.short_name}</span>
                  <span className="text-ink-500"> &middot; {show.city ? `${show.city}, ` : ""}{showDatesLabel(show)}</span>
                </span>
              </label>

              {marked && (
                <div className="mt-3 pl-7 space-y-3">
                  <div className="grid sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-2">
                    <label className="block">
                      <span className="block text-xs text-ink-500 mb-1">Dock / slip</span>
                      <input
                        value={draft.location}
                        maxLength={SHOW_LOCATION_MAX}
                        disabled={!canEdit || working}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [show.key]: { ...draft, location: e.target.value } }))}
                        placeholder="e.g. Dock C, slip 412"
                        className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 disabled:bg-ink-50"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-xs text-ink-500 mb-1">Note for YachtPics (optional)</span>
                      <input
                        value={draft.note}
                        maxLength={SHOW_NOTE_MAX}
                        disabled={!canEdit || working}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [show.key]: { ...draft, note: e.target.value } }))}
                        placeholder="Arriving Tuesday, in-water display"
                        className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 disabled:bg-ink-50"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => save(show, draft, "Saved.")}
                        disabled={!dirty || working}
                        className="text-xs font-semibold px-3 py-1.5 rounded-ctl bg-ink-950 hover:bg-ink-800 text-white transition-colors duration-fast disabled:opacity-40"
                      >
                        {working ? "Saving…" : "Save"}
                      </button>
                    )}
                    {published ? (
                      <a
                        href={cardHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 hover:text-ink-900 transition-colors duration-fast"
                        title="A print-ready card with her cover photograph, specifications, your brand and a QR code"
                      >
                        Dock card (PDF)
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="text-xs font-semibold px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-400 cursor-not-allowed"
                        title="Publish the slideshow first"
                      >
                        Dock card (PDF)
                      </button>
                    )}
                    <select
                      value={size}
                      onChange={(e) => setSize(e.target.value === "letter" ? "letter" : "5x7")}
                      aria-label="Dock card size"
                      className="text-xs border border-hairline-strong rounded-ctl px-2 py-1.5 bg-white text-ink-700"
                    >
                      <option value="5x7">5 &times; 7 in</option>
                      <option value="letter">Letter</option>
                    </select>
                    {!published && <span className="text-xs text-ink-500">Publish the slideshow first.</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
