"use client";

import { useState } from "react";

/**
 * Private notes about a broker — admin broker page only (Oct 28). Stored in
 * broker_admin_notes through /api/admin/broker-notes (service role); never
 * shown anywhere a broker or assistant can see.
 */
export default function AdminNotesEditor({ brokerId, initialNotes, updatedAt, updatedByName }: { brokerId: string; initialNotes: string; updatedAt: string | null; updatedByName: string | null }) {
  const [notes, setNotes] = useState(initialNotes);
  const [saved, setSaved] = useState(initialNotes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stamp, setStamp] = useState<{ at: string | null; by: string | null }>({ at: updatedAt, by: updatedByName });

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/broker-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId, notes }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't save.");
      setSaved(notes);
      setStamp({ at: json.updatedAt ?? new Date().toISOString(), by: "you" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  const dirty = notes !== saved;
  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
      <p className="label-caps mb-2">Private notes — only you and Samantha see these</p>
      <textarea
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 resize-y"
        placeholder="Spouse's name, how they like to be contacted, what they're working on…"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-500">
          {stamp.at ? `Last saved ${new Date(stamp.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}${stamp.by ? ` by ${stamp.by}` : ""}` : "Not saved yet"}
          {error && <span className="text-danger-600 ml-2">{error}</span>}
        </p>
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="bg-accent-500 hover:bg-accent-400 disabled:opacity-40 text-ink-950 text-sm font-semibold px-4 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          {busy ? "Saving…" : dirty ? "Save notes" : "Saved"}
        </button>
      </div>
    </div>
  );
}
