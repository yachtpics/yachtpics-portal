"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { REEL_SERVICE_PRICE, REEL_SERVICE_REELS_PER_BOAT } from "@/lib/plans";

type Sub = { enabled: boolean; reels_per_listing: number; note: string | null; started_at: string | null } | null;
/** An active listing of this broker, for the "In the Reel Service" checkboxes. */
export type ReelCardListing = { id: string; name: string; detail: string };

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * Reel Service enrolment for one broker (billing is handled outside the app,
 * in Zoho; this is the switch). Priced per boat (Oct 23): the admin picks
 * which boats are in the service and the per-boat price for this broker.
 * Enabling plans the rest of this month straight away; the daily cron keeps
 * every month filled after that.
 *
 * `enrolledRows` null = reel_service_listings can't be read (migration not
 * applied) — the boat picker is hidden and every active boat is planned.
 * An enabled broker with no rows at all is "legacy": every active boat is
 * planned until boats are picked here.
 */
export default function ReelServiceCard({ brokerId, initial, priceCents, listings, enrolledRows }: {
  brokerId: string;
  initial: Sub;
  priceCents: number | null;
  listings: ReelCardListing[];
  enrolledRows: { listing_id: string; ended_at: string | null }[] | null;
}) {
  const router = useRouter();
  const legacy = !!initial && enrolledRows !== null && enrolledRows.length === 0;
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [rpm, setRpm] = useState(String(initial?.reels_per_listing ?? REEL_SERVICE_REELS_PER_BOAT));
  const [note, setNote] = useState(initial?.note ?? "");
  const [price, setPrice] = useState(String(priceCents != null ? priceCents / 100 : REEL_SERVICE_PRICE));
  const [checked, setChecked] = useState<string[]>(() => {
    if (!enrolledRows) return [];
    // Legacy brokers have every active boat planned today — show that.
    if (legacy) return listings.map((l) => l.id);
    return enrolledRows.filter((r) => !r.ended_at).map((r) => r.listing_id);
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const priceNum = Number(price);
  const priceOk = price.trim() !== "" && Number.isFinite(priceNum) && priceNum >= 0;
  // Only active listings are offered (and billed here); an enrolled boat that
  // has since sold drops out of the count and the planner skips it.
  const boats = checked.filter((id) => listings.some((l) => l.id === id)).length;

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/reel-service", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error ?? "Couldn’t save.");
    return d;
  }

  async function save(nextEnabled = enabled) {
    if (!priceOk) { setMsg("Enter a price per boat (dollars)."); return; }
    setSaving(true);
    setMsg("");
    try {
      // Boats first, so enabling below plans exactly the chosen boats.
      if (enrolledRows) {
        await post({ action: "listings", brokerId, listingIds: checked, shownListingIds: listings.map((l) => l.id) });
      }
      const d = await post({ action: "subscription", brokerId, enabled: nextEnabled, reelsPerListing: Number(rpm), note, pricePerListing: priceNum });
      setEnabled(nextEnabled);
      setMsg(nextEnabled && enrolledRows && boats === 0 ? "Saved — no boats checked, so nothing is planned." : nextEnabled ? (d.planned ? `Saved — ${d.planned} reel${d.planned === 1 ? "" : "s"} planned for this month across their boats.` : "Saved.") : "Paused.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn’t save.");
    } finally {
      setSaving(false);
    }
  }

  function toggle(id: string, on: boolean) {
    setChecked((c) => (on ? (c.indexOf(id) < 0 ? [...c, id] : c) : c.filter((x) => x !== id)));
  }

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-h2 text-ink-900">Reel Service</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            Social reels every month for the boats you choose below &mdash; {money(REEL_SERVICE_PRICE)} per boat per month for up to {REEL_SERVICE_REELS_PER_BOAT} reels. Billing is handled outside the Portal (Zoho).
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
          Reels per boat each month
          <input type="number" min={1} max={10} value={rpm} onChange={(e) => setRpm(e.target.value)}
            className="block mt-1 w-24 border border-hairline-strong rounded-ctl px-2 py-1.5 text-sm text-ink-900" />
        </label>
        <label className="text-xs text-ink-500">
          Price per boat / month ($)
          <input type="number" min={0} step="1" value={price} onChange={(e) => setPrice(e.target.value)}
            className="block mt-1 w-28 border border-hairline-strong rounded-ctl px-2 py-1.5 text-sm text-ink-900" />
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

      {enrolledRows === null ? (
        <p className="mt-4 text-xs text-warn-800">
          Choosing boats needs the migration <code>20261023_reel_service_listings.sql</code>. Until it&rsquo;s applied, every active listing is planned.
        </p>
      ) : (
        <div className="mt-5 border-t border-hairline pt-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <p className="text-sm font-semibold text-ink-900">Boats in the Reel Service</p>
            <p className="text-sm text-ink-700">
              {boats} boat{boats === 1 ? "" : "s"} &times; {priceOk ? money(priceNum) : "—"} = <strong>{priceOk ? money(boats * priceNum) : "—"}</strong> / month
            </p>
          </div>
          {legacy && (
            <p className="mt-1 text-xs text-warn-800">
              No boats chosen yet, so every active listing is planned (all boats, legacy). Save to keep only the boats checked.
            </p>
          )}
          {listings.length === 0 ? (
            <p className="mt-2 text-xs text-ink-500">No active listings.</p>
          ) : (
            <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1">
              {listings.map((l) => (
                <li key={l.id}>
                  <label className="flex items-center gap-2 text-sm text-ink-700 py-0.5">
                    <input type="checkbox" checked={checked.indexOf(l.id) >= 0} disabled={saving} onChange={(e) => toggle(l.id, e.target.checked)} />
                    <span className="text-ink-900">{l.name}</span>
                    {l.detail && <span className="text-xs text-ink-500">{l.detail}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-500">
            Sold, or off the service? Uncheck it and Save &mdash; that stops next month&rsquo;s plan for the boat. Reels already planned for this month are left as they are.
          </p>
        </div>
      )}
      {msg && <p className="mt-3 text-xs text-ink-600">{msg}</p>}
    </div>
  );
}
