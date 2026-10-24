import { REEL_SERVICE_REELS_PER_BOAT } from "@/lib/plans";

/**
 * Reel Service queue (Oct 24) — the top of the admin board, for Samantha:
 * every boat on the service (paid + comped), plus paid boats that are past
 * due or paused, with reels delivered against the 4 a month, days to the
 * Stripe renewal, the last delivery and a status chip. Fewest delivered
 * first; past-due and paused rows highlighted.
 */

export type QueueStatus = "paid" | "comped" | "past_due" | "paused";
export type QueueRow = {
  listingId: string;
  boat: string;
  brokerId: string;
  broker: string;
  status: QueueStatus;
  delivered: number;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  lastDeliveredAt: string | null;
};

export const STATUS_CHIP: Record<QueueStatus, { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "bg-success-50 text-success-700" },
  comped: { label: "Comped", cls: "bg-ink-100 text-ink-600" },
  past_due: { label: "Past due", cls: "bg-warn-50 text-warn-800" },
  paused: { label: "Paused", cls: "bg-danger-50 text-danger-700" },
};

export function StatusChip({ status }: { status: QueueStatus }) {
  const c = STATUS_CHIP[status];
  return <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${c.cls}`}>{c.label}</span>;
}

function days(iso: string | null): string {
  if (!iso) return "—";
  const d = Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
  return d <= 0 ? "today" : `${d} day${d === 1 ? "" : "s"}`;
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

export default function ReelServiceQueue({ rows, monthLabel, billingReady }: { rows: QueueRow[]; monthLabel: string; billingReady: boolean }) {
  const sorted = rows.slice().sort((a, b) => a.delivered - b.delivered || a.boat.localeCompare(b.boat));
  const owed = rows.reduce((n, r) => n + Math.max(0, REEL_SERVICE_REELS_PER_BOAT - r.delivered), 0);
  return (
    <div className="mt-6 bg-white border border-hairline rounded-card shadow-elev-1">
      <div className="px-5 py-4 border-b border-hairline flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-h2 text-ink-900">Queue</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            Every boat on the service for {monthLabel} &mdash; {rows.length} boat{rows.length === 1 ? "" : "s"}, {owed} reel{owed === 1 ? "" : "s"} still to deliver. Fewest delivered first.
          </p>
        </div>
        {!billingReady && (
          <p className="text-xs text-warn-800">Paid / comped status needs <code>20261024_reel_service_stripe.sql</code>; until then every boat shows as comped.</p>
        )}
      </div>
      {sorted.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-400">No boats on the service yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500 border-b border-hairline">
                <th className="px-5 py-2 font-medium">Boat</th>
                <th className="px-3 py-2 font-medium">Broker</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium tabular-nums">Delivered</th>
                <th className="px-3 py-2 font-medium">Renews in</th>
                <th className="px-3 py-2 font-medium">Last delivery</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.listingId} className={`border-b border-hairline last:border-b-0 ${r.status === "past_due" ? "bg-warn-50" : r.status === "paused" ? "bg-danger-50" : ""}`}>
                  <td className="px-5 py-2">
                    <a href={`/admin/listings/${r.listingId}`} className="text-ink-900 font-medium hover:underline">{r.boat}</a>
                  </td>
                  <td className="px-3 py-2">
                    <a href={`/admin/brokers/${r.brokerId}`} className="text-ink-700 hover:underline">{r.broker}</a>
                  </td>
                  <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                  <td className={`px-3 py-2 tabular-nums ${r.delivered >= REEL_SERVICE_REELS_PER_BOAT ? "text-success-700" : "text-ink-900"}`}>
                    {r.delivered} / {REEL_SERVICE_REELS_PER_BOAT}
                  </td>
                  <td className="px-3 py-2 text-ink-700">
                    {r.status === "comped" ? "—" : r.cancelAtPeriodEnd ? `ends ${shortDate(r.renewsAt)}` : days(r.renewsAt)}
                  </td>
                  <td className="px-3 py-2 text-ink-700">{shortDate(r.lastDeliveredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
