"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { REEL_SERVICE_PRICE, REEL_SERVICE_REELS_PER_BOAT } from "@/lib/plans";

type Sub = { enabled: boolean; reels_per_listing: number; note: string | null; started_at: string | null } | null;
/** An active listing of this broker, for the "In the Reel Service" checkboxes. */
export type ReelCardListing = { id: string; name: string; detail: string };
/** A reel_service_listings row; billing fields absent before migration 20261024. */
export type ReelCardRow = { listing_id: string; ended_at: string | null; billing_status?: string | null; current_period_end?: string | null; cancel_at_period_end?: boolean | null; note?: string | null };

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
/** Paid through Stripe and still running — not the admin's to switch off here. */
/** Ended by the "Comped reels on" switch (the API's COMP_SWITCH_MARK); comes back when it's switched on. */
const offBySwitch = (r: ReelCardRow | undefined) => !!r && !!r.ended_at && r.billing_status === "comped" && (r.note ?? "").indexOf("[ended: comped reels switched off]") >= 0;
const isPaid = (r: ReelCardRow | undefined) => !!r && !r.ended_at && (r.billing_status === "active" || r.billing_status === "past_due" || r.billing_status === "paused");

/**
 * Reel Service enrolment for one broker. Since Oct 24 brokers pay per boat
 * ($179/month) through Stripe from the listing page; those boats show here as
 * "Paid" and can't be unchecked (the broker cancels, or it ends in Stripe).
 * The checkboxes are the comp / override path: a boat checked here is on the
 * service at no charge ("comped — no charge"). The Zoho price field is gone.
 * Enabling plans the rest of this month straight away; the daily cron keeps
 * every month filled after that.
 *
 * `enrolledRows` null = reel_service_listings can't be read (migration not
 * applied) — the boat picker is hidden and every active boat is planned.
 * An enabled broker with no rows at all is "legacy": every active boat is
 * planned until boats are picked here.
 */
export default function ReelServiceCard({ brokerId, initial, listings, enrolledRows }: {
  brokerId: string;
  initial: Sub;
  listings: ReelCardListing[];
  enrolledRows: ReelCardRow[] | null;
}) {
  const router = useRouter();
  const legacy = !!initial && enrolledRows !== null && enrolledRows.length === 0;
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [rpm, setRpm] = useState(String(initial?.reels_per_listing ?? REEL_SERVICE_REELS_PER_BOAT));
  const [note, setNote] = useState(initial?.note ?? "");
  const rowFor = (id: string) => enrolledRows?.find((r) => r.listing_id === id);
  const [checked, setChecked] = useState<string[]>(() => {
    if (!enrolledRows) return [];
    // Legacy brokers have every active boat planned today — show that.
    if (legacy) return listings.map((l) => l.id);
    return enrolledRows.filter((r) => !r.ended_at && r.billing_status !== "canceled" && r.billing_status !== "paused").map((r) => r.listing_id)
      .concat(enrolledRows.filter((r) => isPaid(r) || offBySwitch(r)).map((r) => r.listing_id))
      .filter((x, i, a) => a.indexOf(x) === i);
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Only active listings are offered; an enrolled boat that has since sold
  // drops out of the count and the planner skips it.
  const shown = checked.filter((id) => listings.some((l) => l.id === id));
  const paidCount = shown.filter((id) => isPaid(rowFor(id))).length;
  const compCount = shown.length - paidCount;
  const boats = shown.length;

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
    setSaving(true);
    setMsg("");
    try {
      // Boats first, so enabling below plans exactly the chosen boats.
      if (enrolledRows) {
        await post({ action: "listings", brokerId, listingIds: checked, shownListingIds: listings.map((l) => l.id) });
      }
      const d = await post({ action: "subscription", brokerId, enabled: nextEnabled, reelsPerListing: Number(rpm), note });
      setEnabled(nextEnabled);
      setMsg(nextEnabled && enrolledRows && boats === 0 ? "Saved — no boats checked, so nothing is planned." : nextEnabled ? (d.planned ? `Saved — ${d.planned} reel${d.planned === 1 ? "" : "s"} planned for this month across their boats.` : "Saved.") : paidCount > 0 ? "Comped reels off. Paid boats keep running." : "Comped reels off.");
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
            Up to {REEL_SERVICE_REELS_PER_BOAT} social reels a month per boat. Brokers pay {money(REEL_SERVICE_PRICE)} per boat per month by card from the boat&rsquo;s page; boats you check here are comped &mdash; no charge.
            {initial?.started_at && enabled ? ` Enrolled ${new Date(initial.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}.` : ""}
          </p>
        </div>
        <Link href="/admin/reel-service" className="text-accent-700 hover:text-accent-800 text-sm font-medium">Open Reel Service &rarr;</Link>
      </div>
      <div className="mt-4 flex items-end gap-4 flex-wrap">
        <div>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={enabled} disabled={saving} onChange={(e) => void save(e.target.checked)} />
            Comped reels on
          </label>
          <p className="text-[11px] text-ink-500 mt-0.5">Paid boats run until the broker cancels or payment fails.</p>
        </div>
        <label className="text-xs text-ink-500">
          Reels per boat each month
          <input type="number" min={1} max={10} value={rpm} onChange={(e) => setRpm(e.target.value)}
            className="block mt-1 w-24 border border-hairline-strong rounded-ctl px-2 py-1.5 text-sm text-ink-900" />
        </label>
        <label className="text-xs text-ink-500 flex-1 min-w-[12rem]">
          Note (optional)
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. why it’s comped"
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
              {boats} boat{boats === 1 ? "" : "s"}: <strong>{paidCount} paid</strong> ({money(paidCount * REEL_SERVICE_PRICE)}/mo through Stripe) &middot; {compCount} comped &mdash; no charge
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
              {listings.map((l) => {
                const r = rowFor(l.id);
                const paid = isPaid(r);
                const on = checked.indexOf(l.id) >= 0;
                return (
                  <li key={l.id}>
                    <label className="flex items-center gap-2 text-sm text-ink-700 py-0.5 flex-wrap" title={paid ? "Paid by the broker through Stripe. They cancel it from the listing page." : undefined}>
                      <input type="checkbox" checked={on} disabled={saving || paid} onChange={(e) => toggle(l.id, e.target.checked)} />
                      <span className="text-ink-900">{l.name}</span>
                      {l.detail && <span className="text-xs text-ink-500">{l.detail}</span>}
                      {paid ? (
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${r?.billing_status === "active" ? "bg-success-50 text-success-700" : r?.billing_status === "past_due" ? "bg-warn-50 text-warn-800" : "bg-danger-50 text-danger-700"}`}>
                          {r?.billing_status === "active" ? "Paid" : r?.billing_status === "past_due" ? "Past due" : "Paused"}
                          {r?.cancel_at_period_end && r.current_period_end ? ` · ends ${shortDate(r.current_period_end)}` : r?.current_period_end && r.billing_status === "active" ? ` · renews ${shortDate(r.current_period_end)}` : ""}
                        </span>
                      ) : on && !enabled ? (
                        <span className="text-[11px] text-ink-500">comped &mdash; off while comped reels are off</span>
                      ) : on ? (
                        <span className="text-[11px] text-ink-500">comped &mdash; no charge</span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-500">
            Checking a boat comps it (no charge). Sold, or off the service? Uncheck a comped boat and Save &mdash; that stops next month&rsquo;s plan for the boat. Reels already planned for this month are left as they are. Paid boats end when the broker cancels, or by themselves when the listing is sold or archived.
          </p>
        </div>
      )}
      {msg && <p className="mt-3 text-xs text-ink-600">{msg}</p>}
    </div>
  );
}
