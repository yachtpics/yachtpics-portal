"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Sub = { enabled: boolean; reels_per_listing: number; note: string | null; started_at: string | null } | null;

/**
 * Reel Service enrolment for one broker (billing is handled outside the app;
 * this is the switch). Enabling plans the rest of this month straight away;
 * the daily cron keeps every month filled after that.
 */
export default function ReelServiceCard({ brokerId, initial }: { brokerId: string; initial: Sub }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [rpm, setRpm] = useState(String(initial?.reels_per_listing ?? 4));
  const [note, setNote] = useState(initial?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save(nextEnabled = enabled) {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/reel-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "subscription", brokerId, enabled: nextEnabled, reelsPerListing: Number(rpm), note }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? "Couldn’t save.");
      setEnabled(nextEnabled);
      setMsg(nextEnabled ? (d.planned ? `Saved — ${d.planned} reel${d.planned === 1 ? "" : "s"} planned for this month across their listings.` : "Saved.") : "Paused.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn’t save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-h2 text-ink-900">Reel Service</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            Social reels every month for each of this broker&rsquo;s active listings. Billing is handled outside the Portal.
            {initial?.started_at && enabled ? ` Enrolled ${new Date(initial.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}.` : ""}
          </p>
        </div>
        <Link href="/admin/reel-service" className="text-accent-700 hover:text-accent-800 text-sm font-medium">Open Reel Service &rarr;</Link>
      </div>
      <div className="mt-4 flex items-end gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={enabled} disabled={saving} onChange={(e) => void save(e.target.checked)} />
          Enabled
        </label>
        <label className="text-xs text-ink-500">
          Reels per listing each month
          <input type="number" min={1} max={10} value={rpm} onChange={(e) => setRpm(e.target.value)}
            className="block mt-1 w-24 border border-hairline-strong rounded-ctl px-2 py-1.5 text-sm text-ink-900" />
        </label>
        <label className="text-xs text-ink-500 flex-1 min-w-[12rem]">
          Note (optional)
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. N&J package, invoiced quarterly"
            className="block mt-1 w-full border border-hairline-strong rounded-ctl px-2 py-1.5 text-sm text-ink-900" />
        </label>
        <button onClick={() => void save()} disabled={saving}
          className="bg-accent-500 hover:bg-accent-400 disabled:opacity-40 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {msg && <p className="mt-3 text-xs text-ink-600">{msg}</p>}
    </div>
  );
}
