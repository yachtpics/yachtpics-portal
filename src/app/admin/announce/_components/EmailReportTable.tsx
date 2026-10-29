import type { EmailReport } from "@/lib/emailReport";

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : "";

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

/** Results of one email send: totals, then one row per recipient (server-rendered). */
export default function EmailReportTable({ report }: { report: EmailReport }) {
  const { totals, rows } = report;
  const tiles = [
    { label: "Sent", value: String(totals.sent), sub: "" },
    { label: "Opened", value: pct(totals.opened, totals.sent), sub: `${totals.opened}` },
    { label: "Clicked", value: pct(totals.clicked, totals.sent), sub: `${totals.clicked}` },
    { label: "Signed in", value: pct(totals.signedIn, totals.sent), sub: `${totals.signedIn}` },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-ink-100 bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-ink-400">{t.label}</p>
            <p className="text-2xl font-semibold text-ink-900 tabular-nums mt-0.5">{t.value}</p>
            {t.sub && <p className="text-xs text-ink-400 tabular-nums">{t.sub} people</p>}
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-400 mt-2 max-w-3xl">
        Opens are approximate: some mail apps load images automatically (counted as an open even if unread) and others block them. A
        click also counts as an open. Signed in = signed in to the Portal within 7 days of this email. Times are Eastern.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 mt-4">Nothing sent yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-ink-100 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-3 py-2">Recipient</th>
                <th className="text-left font-medium px-3 py-2">Sent</th>
                <th className="text-left font-medium px-3 py-2">Opened</th>
                <th className="text-left font-medium px-3 py-2">Clicks</th>
                <th className="text-left font-medium px-3 py-2">Signed in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {rows.map((r) => (
                <tr key={r.logId}>
                  <td className="px-3 py-2">
                    <p className="text-ink-900">{r.name}</p>
                    {r.name !== r.email && <p className="text-xs text-ink-400">{r.email}</p>}
                  </td>
                  <td className="px-3 py-2 text-ink-500 whitespace-nowrap">{fmt(r.sentAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.firstOpenAt ? <span className="text-ink-700">{fmt(r.firstOpenAt)}</span> : r.opened ? <span className="text-ink-700">via click</span> : <span className="text-ink-300">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.clicks ? <span className="text-ink-700">{r.clicks} &middot; {fmt(r.firstClickAt)}</span> : <span className="text-ink-300">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.signedInAt ? <span className="text-emerald-700 font-medium">{fmt(r.signedInAt)}</span> : <span className="text-ink-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
