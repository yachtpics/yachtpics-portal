"use client";

import { useState } from "react";
import { customMetaDescription } from "@/lib/siteAltText";

/** The length the website text is written to (same numbers as the AI prompt in src/lib/ai.ts). */
const TEXT_MIN = 250;
const TEXT_MAX = 420;

/**
 * "Website page" — the words on this boat's yachtpics.com page, next to the
 * publish controls: the website text (listings.site_description — the page's
 * intro and its Google description) and the location (Specs, and the Google
 * description).
 *
 * The website text is YachtPics' own, separate from the broker's listing
 * description (which is shown below for reference only and never used on the
 * website). Saved through POST /api/admin/listings/[id]/site-text (admin
 * only). "Draft from photos" asks the AI for a draft and puts it in the box —
 * nothing is saved until Save. The live page only changes when the boat is
 * next published — "Save & re-publish" does both.
 */
export default function WebsitePageCard({
  listingId,
  initialSiteDescription,
  initialLocation,
  initialDraft,
  initialLocationSuggestion,
  brokerDescription,
  onSite,
  onMessage,
}: {
  listingId: string;
  initialSiteDescription: string | null;
  initialLocation: string | null;
  initialDraft: string | null;
  initialLocationSuggestion: string | null;
  brokerDescription: string | null;
  onSite: boolean;
  onMessage: (text: string, kind?: "success" | "error" | "info") => void;
}) {
  const [saved, setSaved] = useState({ description: initialSiteDescription ?? "", location: initialLocation ?? "" });
  const [description, setDescription] = useState(initialSiteDescription ?? "");
  const [location, setLocation] = useState(initialLocation ?? "");
  const [waitingDraft, setWaitingDraft] = useState((initialDraft ?? "").trim());
  const [suggestion, setSuggestion] = useState((initialLocationSuggestion ?? "").trim());
  const [busy, setBusy] = useState<"" | "save" | "publish" | "draft" | "discard" | "dismiss">("");
  const [error, setError] = useState<string | null>(null);
  const [beforeDraft, setBeforeDraft] = useState<string | null>(null);
  const [showBroker, setShowBroker] = useState(false);

  const trimmed = description.trim();
  const descDirty = trimmed !== saved.description.trim();
  const locDirty = location.trim() !== saved.location.trim();
  const dirty = descDirty || locDirty;
  const google = trimmed ? customMetaDescription(trimmed, location.trim() || null) : "";
  const lengthOk = trimmed.length >= TEXT_MIN && trimmed.length <= TEXT_MAX;
  const broker = (brokerDescription ?? "").trim();

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/listings/${listingId}/site-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Couldn't save (the server answered ${res.status}).`);
    return data as {
      listing?: { siteDescription: string | null; siteDescriptionDraft: string | null; location: string | null; siteLocationSuggestion: string | null };
    };
  }

  async function save(republish: boolean) {
    if (busy) return;
    setBusy(republish ? "publish" : "save");
    setError(null);
    try {
      if (dirty) {
        const body: Record<string, unknown> = { action: "save" };
        if (descDirty) body.siteDescription = trimmed;
        if (locDirty) body.location = location.trim();
        const data = await post(body);
        const l = data.listing;
        setSaved({ description: l?.siteDescription ?? trimmed, location: l?.location ?? location.trim() });
        setDescription(l?.siteDescription ?? trimmed);
        setLocation(l?.location ?? location.trim());
        if (descDirty) setWaitingDraft("");
        if (locDirty) setSuggestion("");
        setBeforeDraft(null);
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
      if (!res.ok) throw new Error(data.error ? `Saved, but re-publishing failed: ${data.error}` : "Saved, but re-publishing failed.");
      if (data.previewOnly) onMessage(`Saved. Page generated but not uploaded — ${data.reason}`, "info");
      else onMessage("Saved and re-published — the yachtpics.com page is updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy("");
    }
  }

  async function draftFromPhotos() {
    if (busy) return;
    setBusy("draft");
    setError(null);
    try {
      const res = await fetch(`/api/admin/listings/${listingId}/site-describe`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          res.status === 504
            ? "The AI took too long to answer (over a minute). Try again in a moment."
            : data.error
              ? `Couldn't draft: ${data.error}`
              : `Couldn't draft (the server answered ${res.status}).`
        );
      }
      if (!data.configured) throw new Error("AI drafting isn't switched on for the Portal (ANTHROPIC_API_KEY is missing).");
      const draft = typeof data.draft === "string" ? data.draft.trim() : "";
      if (!draft) throw new Error("The AI didn't return any text. Try again.");
      setBeforeDraft(description);
      setDescription(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't draft.");
    } finally {
      setBusy("");
    }
  }

  async function discardDraft() {
    if (busy) return;
    setBusy("discard");
    setError(null);
    try {
      await post({ action: "discard" });
      setWaitingDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't discard the draft.");
    } finally {
      setBusy("");
    }
  }

  async function dismissSuggestion() {
    if (busy) return;
    setBusy("dismiss");
    setError(null);
    try {
      await post({ action: "dismissLocation" });
      setSuggestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't dismiss the suggestion.");
    } finally {
      setBusy("");
    }
  }

  const inputClass =
    "w-full bg-white border border-hairline-strong text-ink-900 placeholder:text-ink-400 rounded-ctl px-3 py-2 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40 transition-colors duration-fast ease-quiet";
  const smallBtn =
    "bg-white hover:border-ink-400 hover:text-ink-900 disabled:opacity-50 text-ink-700 text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong transition-colors duration-fast ease-quiet";

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

      {error && (
        <div role="alert" className="mt-4 flex items-start justify-between gap-3 bg-danger-50 border border-danger-200 text-danger-700 text-sm rounded-ctl px-3 py-2">
          <p>{error}</p>
          <button onClick={() => setError(null)} className="shrink-0 font-bold leading-none" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {waitingDraft && (
        <div className="mt-4 bg-accent-50 border border-accent-500/40 rounded-ctl px-3 py-2.5 text-sm">
          <p className="text-ink-700">
            <span className="font-semibold text-ink-900">A draft is waiting: </span>
            {waitingDraft}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => {
                setBeforeDraft(description);
                setDescription(waitingDraft);
              }}
              disabled={!!busy}
              className={smallBtn}
            >
              Use this draft
            </button>
            <button onClick={discardDraft} disabled={!!busy} className={smallBtn}>
              {busy === "discard" ? "Discarding…" : "Discard"}
            </button>
            <span className="text-xs text-ink-400">&ldquo;Use&rdquo; puts it in the box below — edit, then Save.</span>
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-end justify-between gap-3 mb-1.5 flex-wrap">
          <label htmlFor="wpDescription" className="block label-caps">Website text</label>
          <button
            onClick={draftFromPhotos}
            disabled={!!busy}
            className="bg-white hover:border-ink-400 hover:text-ink-900 disabled:opacity-60 text-ink-700 text-xs font-semibold px-3 py-1.5 rounded-ctl border border-hairline-strong transition-colors duration-fast ease-quiet"
          >
            {busy === "draft" ? "Drafting from photos… (up to a minute)" : "Draft from photos"}
          </button>
        </div>
        <textarea
          id="wpDescription"
          className={`${inputClass} resize-y ${busy === "draft" ? "opacity-60" : ""}`}
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy === "draft"}
          placeholder="2–3 sentences: year, builder, model and name first; then what the photo shoot shows."
        />
        <div className="mt-1 flex items-start justify-between gap-3 text-xs">
          <p className="text-ink-400">
            2–3 sentences. Shown as the intro on the yachtpics.com page and as the Google description. Separate from the broker&rsquo;s description.
          </p>
          <span className={`shrink-0 tabular-nums ${trimmed && !lengthOk ? "text-warn-700" : "text-ink-400"}`}>
            {trimmed.length} character{trimmed.length === 1 ? "" : "s"}
            {trimmed ? ` · aim for ${TEXT_MIN}–${TEXT_MAX}` : ""}
          </span>
        </div>
        {beforeDraft !== null && (
          <p className="mt-1 text-xs text-accent-700">
            Draft placed in the box — not saved yet. Read it, edit it, then Save.{" "}
            <button
              onClick={() => {
                setDescription(beforeDraft);
                setBeforeDraft(null);
              }}
              className="underline hover:text-accent-600"
            >
              Put back the previous text
            </button>
          </p>
        )}
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
        {suggestion && suggestion !== location.trim() && (
          <div className="mt-2 flex items-center gap-2 flex-wrap text-sm">
            <span className="text-ink-700">
              <span className="text-ink-500">Photos say: </span>
              <span className="font-semibold text-ink-900">{suggestion}</span>
            </span>
            <button onClick={() => setLocation(suggestion)} disabled={!!busy} className={smallBtn}>
              Use
            </button>
            <button onClick={dismissSuggestion} disabled={!!busy} className={smallBtn}>
              {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
            </button>
          </div>
        )}
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

      {broker && (
        <div className="mt-5 border-t border-hairline pt-3">
          <button
            onClick={() => setShowBroker((v) => !v)}
            className="text-xs font-medium text-ink-500 hover:text-ink-800 transition-colors duration-fast"
            aria-expanded={showBroker}
          >
            {showBroker ? "▾" : "▸"} Broker&rsquo;s description (not used on the website)
          </button>
          {showBroker && (
            <p className="mt-2 text-xs text-ink-500 whitespace-pre-line bg-ink-50 border border-hairline rounded-ctl px-3 py-2">{broker}</p>
          )}
        </div>
      )}
    </div>
  );
}
