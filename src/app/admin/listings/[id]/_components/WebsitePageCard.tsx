"use client";

import { useState } from "react";
import { customMetaDescription, META_DESCRIPTION_MAX } from "@/lib/siteAltText";

/**
 * "Website page" — the words on this boat's yachtpics.com page, in one place
 * next to the publish controls: the description (the page's intro and its
 * Google description) and the location (Specs, and the Google description).
 *
 * Same columns as Edit vessel details (listings.description / .location),
 * saved through the same PATCH /api/listings/[id]. The live page only changes
 * when the boat is next published — "Save & re-publish" does both.
 */
export default function WebsitePageCard({
  listingId,
  initialDescription,
  initialLocation,
  onSite,
  onMessage,
}: {
  listingId: string;
  initialDescription: string | null;
  initialLocation: string | null;
  onSite: boolean;
  onMessage: (text: string, kind?: "success" | "error" | "info") => void;
}) {
  const [saved, setSaved] = useState({ description: initialDescription ?? "", location: initialLocation ?? "" });
  const [description, setDescription] = useState(initialDescription ?? "");
  const [location, setLocation] = useState(initialLocation ?? "");
  const [busy, setBusy] = useState<"" | "save" | "publish">("");

  const dirty = description !== saved.description || location !== saved.location;
  const trimmed = description.trim();
  const google = trimmed ? customMetaDescription(trimmed, location.trim() || null) : "";

  async function save(republish: boolean) {
    if (busy) return;
    setBusy(republish ? "publish" : "save");
    try {
      if (dirty) {
        const res = await fetch(`/api/listings/${listingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: trimmed || null, location: location.trim() || null }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Couldn't save.");
        setSaved({ description: trimmed, location: location.trim() });
        setDescription(trimmed);
        setLocation(location.trim());
      }
      if (!republish) {
        onMessage(onSite ? "Saved — re-publish to update the yachtpics.com page." : "Saved.");
        return;
      }
      const res = await fetch(`/api/admin/listings/${listingId}/publish-site`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Saved, but re-publishing failed.");
      if (data.previewOnly) onMessage(`Saved. Page generated but not uploaded — ${data.reason}`, "info");
      else onMessage("Saved and re-published — the yachtpics.com page is updated.");
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Couldn't save.", "error");
    } finally {
      setBusy("");
    }
  }

  const inputClass =
    "w-full bg-white border border-hairline-strong text-ink-900 placeholder:text-ink-400 rounded-ctl px-3 py-2 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40 transition-colors duration-fast ease-quiet";

  return (
    <div id="website-page" className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6 scroll-mt-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-ink-900">Website page</h2>
          <p className="text-ink-500 text-sm mt-0.5">The words on this boat&rsquo;s yachtpics.com page.</p>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${onSite ? "border-accent-500 bg-accent-50 text-accent-700" : "border-hairline-strong text-ink-500"}`}>
          {onSite ? "On yachtpics.com" : "Not on yachtpics.com yet"}
        </span>
      </div>

      <div className="mt-4">
        <label htmlFor="wpDescription" className="block label-caps mb-1.5">Description</label>
        <textarea
          id="wpDescription"
          className={`${inputClass} resize-y`}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="2–3 sentences about the boat: what she is, what stands out, recent upgrades."
        />
        <div className="mt-1 flex items-start justify-between gap-3 text-xs">
          <p className="text-ink-400">
            Used as the intro and Google description on the yachtpics.com page. 2–3 sentences is right.
            It&rsquo;s the same description as on Edit vessel details, so it also shows in the client slideshow and on the spec sheet.
          </p>
          <span className={`shrink-0 tabular-nums ${trimmed.length > META_DESCRIPTION_MAX ? "text-warn-700" : "text-ink-400"}`}>
            {trimmed.length} character{trimmed.length === 1 ? "" : "s"}
          </span>
        </div>
        {trimmed ? (
          <p className="mt-2 text-xs text-ink-500">
            <span className="text-ink-400">Google shows: </span>
            {google}
          </p>
        ) : (
          <p className="mt-2 text-xs text-ink-400">Empty — the page uses the standard generated sentence.</p>
        )}
      </div>

      <div className="mt-4 max-w-sm">
        <label htmlFor="wpLocation" className="block label-caps mb-1.5">Location</label>
        <input
          id="wpLocation"
          className={inputClass}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Palm Beach, FL"
        />
        <p className="mt-1 text-xs text-ink-400">Shown in the page&rsquo;s specs and worked into the Google description.</p>
      </div>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          onClick={() => save(false)}
          disabled={!!busy || !dirty}
          className="bg-white hover:border-ink-400 hover:text-ink-900 disabled:opacity-50 text-ink-700 text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong transition-colors duration-fast ease-quiet"
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        {onSite && (
          <button
            onClick={() => save(true)}
            disabled={!!busy}
            className="bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            {busy === "publish" ? "Publishing…" : dirty ? "Save & re-publish" : "Re-publish page"}
          </button>
        )}
        <span className="text-xs text-ink-400">
          {onSite
            ? "Changes reach yachtpics.com on the next publish."
            : "Saved now; it goes on the page when the boat is published."}
        </span>
      </div>
    </div>
  );
}
