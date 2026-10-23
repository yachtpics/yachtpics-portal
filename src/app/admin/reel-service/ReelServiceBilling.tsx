"use client";

import { useEffect, useState } from "react";
import { periodET, periodLabel, previousPeriod } from "@/lib/reelService";

type Boat = { listingId: string; boat: string; delivered: number };
type Broker = { brokerId: string; name: string; legacy: boolean; priceCents: number; boats: Boat[]; delivered: number; amountCents: number };
type Summary = { period: string; brokers: Broker[]; totalCents: number };

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Plain text for pasting into a Zoho invoice: a line per broker, a sub-line per boat. */
function zohoText(s: Summary): string {
  const lines = [`YachtPics Reel Service — ${periodLabel(s.period)}`, ""];
  s.brokers.forEach((b) => {
    lines.push(`${b.name} — ${b.boats.length} boat${b.boats.length === 1 ? "" : "s"} — ${usd(b.amountCents)}`);
    b.boats.forEach((x) => lines.push(`    ${x.boat} — ${x.delivered} reel${x.delivered === 1 ? "" : "s"} delivered (${usd(b.priceCents)}/month)`));
    lines.push("");
  });
  lines.push(`Total — ${usd(s.totalCents)}`);
  return lines.join("\n");
}

/**
 * "This month's billing" — what to invoice in Zoho for the Reel Service
 * (nothing is charged in the app). Boats in the service × each broker's
 * per-boat price, with reels delivered for context. Current or last month.
 * Loaded only when opened, via the admin API (service role).
 */
export default function ReelServiceBilling() {
  const thisMonth = periodET();
  const months = [thisMonth, previousPeriod(thisMonth)];
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(thisMonth);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setMsg("");
    fetch("/api/admin/reel-service", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "billing", period }) })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d?.error ?? `Failed (${res.status}).`);
        if (!cancelled) setData(d as Summary);
      })
      .catch((e) => { if (!cancelled) { setData(null); setMsg(e instanceof Error ? e.message : "Couldn’t load billing."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, period]);

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(zohoText(data));
      setMsg("Copied — paste it into the Zoho invoice.");
    } catch {
      setMsg("Couldn’t copy — select the summary and copy it by hand.");
    }
  }

  return (
    <details className="mt-5 bg-white border border-hairline rounded-card shadow-elev-1" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="px-5 py-3 cursor-pointer text-sm font-semibold text-ink-900">This month&rsquo;s billing</summary>
      <div className="px-5 pb-5">
        <div className="flex items-end gap-3 flex-wrap">
          <label className="text-xs text-ink-500">
            Month
            <select value={period} onChange={(e) => setPeriod(e.target.value)}
              className="block mt-1 border border-hairline-strong rounded-ctl px-2 py-1.5 text-sm text-ink-900">
              {months.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}
            </select>
          </label>
          <button onClick={() => void copy()} disabled={!data || data.brokers.length === 0}
            className="text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 disabled:opacity-40">
            Copy for Zoho
          </button>
          <p className="text-xs text-ink-500">Billed outside the Portal. A boat counts if it was in the service at any point that month.</p>
        </div>
        {msg && <p className="mt-3 text-xs text-ink-600">{msg}</p>}
        {loading && <p className="mt-3 text-sm text-ink-500">Loading…</p>}
        {!loading && data && (data.brokers.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">No enrolled brokers.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500 border-b border-hairline">
                  <th className="py-2 pr-4 font-medium">Broker</th>
                  <th className="py-2 pr-4 font-medium">Boats in service</th>
                  <th className="py-2 pr-4 font-medium text-right">Reels delivered</th>
                  <th className="py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.brokers.map((b) => (
                  <tr key={b.brokerId} className="border-b border-hairline align-top">
                    <td className="py-2 pr-4">
                      <a href={`/admin/brokers/${b.brokerId}`} className="text-ink-900 hover:underline">{b.name}</a>
                      {b.legacy && <span className="block text-xs text-warn-800">all boats (legacy)</span>}
                    </td>
                    <td className="py-2 pr-4 text-ink-700">
                      {b.boats.length} &times; {usd(b.priceCents)}
                      {b.boats.length > 0 && (
                        <ul className="mt-0.5 text-xs text-ink-500">
                          {b.boats.map((x) => <li key={x.listingId}>{x.boat} &middot; {x.delivered} delivered</li>)}
                        </ul>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right text-ink-700">{b.delivered}</td>
                    <td className="py-2 text-right text-ink-900 font-medium">{usd(b.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-3 font-semibold text-ink-900" colSpan={3}>Total</td>
                  <td className="pt-3 text-right font-semibold text-ink-900">{usd(data.totalCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}
      </div>
    </details>
  );
}
