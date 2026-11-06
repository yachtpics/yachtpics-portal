import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { BRAND_LABEL, fmtDate, fmtMoney, type BrandKey } from "@/lib/books/types";
import type { ClientSum, Dashboard, RangePreset } from "@/lib/books/reports";

/*
 * Dashboard — one login's book. Server-rendered: the range picker is plain
 * links and a GET form, the chart is hand-built SVG (no chart library).
 * Bars per period: Invoiced (issued in the period, void excluded), Paid
 * (payments received in the period), Outstanding (what's still owed on the
 * period's invoices). The tables underneath are "now" for outstanding /
 * overdue and the chosen range for paid.
 */

const SERIES = [
  { key: "invoiced" as const, label: "Invoiced", cls: "fill-ink-300", dot: "bg-ink-300" },
  { key: "paid" as const, label: "Paid", cls: "fill-accent-500", dot: "bg-accent-500" },
  { key: "outstanding" as const, label: "Outstanding", cls: "fill-ink-800", dot: "bg-ink-800" },
];

function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const short = (n: number) => (n >= 1000 ? `$${Math.round(n / 100) / 10}k` : `$${Math.round(n)}`);

function Chart({ dash }: { dash: Dashboard }) {
  const W = 720, H = 240, L = 48, B = 26, T = 10;
  const n = dash.buckets.length || 1;
  let max = 0;
  dash.buckets.forEach((b) => { max = Math.max(max, b.invoiced, b.paid, b.outstanding); });
  max = niceMax(max);
  const slot = (W - L) / n;
  const bw = Math.max(2, Math.min(16, (slot - 6) / 3));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = n > 16 ? Math.ceil(n / 12) : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Invoiced, paid and outstanding by period">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W} y1={y(t)} y2={y(t)} className="stroke-ink-200" strokeWidth={t === 0 ? 1 : 0.5} />
          <text x={L - 6} y={y(t) + 3} textAnchor="end" className="fill-ink-400" fontSize="10">{short(t)}</text>
        </g>
      ))}
      {dash.buckets.map((b, i) => {
        const x0 = L + i * slot + (slot - bw * 3 - 4) / 2;
        return (
          <g key={b.key}>
            {SERIES.map((s, k) => {
              const v = b[s.key];
              const yy = y(v);
              return (
                <rect key={s.key} x={x0 + k * (bw + 2)} y={yy} width={bw} height={Math.max(0, H - B - yy)} className={s.cls} rx={1}>
                  <title>{`${b.label} · ${s.label} ${fmtMoney(v)}`}</title>
                </rect>
              );
            })}
            {i % every === 0 && (
              <text x={L + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="fill-ink-500" fontSize="10">{b.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function SumTable({ title, rows, late, empty }: { title: string; rows: ClientSum[]; late?: boolean; empty: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="p-0">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-500 px-6 py-5">{empty}</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.slice(0, 25).map((r) => (
              <li key={(r.clientId ?? "-") + title} className="px-6 py-2.5 flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink-800">
                  {r.name}
                  <span className="text-small text-ink-400"> · {r.count}{late && r.daysLate ? ` · ${r.daysLate} days late` : ""}</span>
                </span>
                <span className="tabular-nums text-ink-900 shrink-0">{fmtMoney(r.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export default function DashboardPanel({
  dash,
  preset,
  brand,
  brands,
}: {
  dash: Dashboard;
  preset: RangePreset;
  brand: BrandKey | "";
  brands: BrandKey[];
}) {
  const base = (p: RangePreset, b: BrandKey | "" = brand) => `/admin/billing?tab=dashboard&range=${p}${b ? `&brand=${b}` : ""}`;
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-[6px] text-xs font-semibold transition-colors duration-base ease-quiet ${active ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-900"}`;
  const exportHref = `/api/admin/books/export?from=${dash.from}&to=${dash.to}${brand ? `&brand=${brand}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="inline-flex rounded-ctl border border-hairline-strong p-0.5 bg-white">
            {(["month", "quarter", "year"] as RangePreset[]).map((p) => (
              <Link key={p} href={base(p)} className={chip(preset === p)}>{p === "month" ? "Month" : p === "quarter" ? "Quarter" : "Year"}</Link>
            ))}
          </div>
          <form action="/admin/billing" className="flex items-center gap-1.5">
            <input type="hidden" name="tab" value="dashboard" />
            <input type="hidden" name="range" value="custom" />
            {brand && <input type="hidden" name="brand" value={brand} />}
            <input type="date" name="from" defaultValue={preset === "custom" ? dash.from : ""} className="rounded-ctl border border-hairline-strong px-2 py-1.5 text-xs bg-white" aria-label="From" />
            <span className="text-ink-400 text-xs">to</span>
            <input type="date" name="to" defaultValue={preset === "custom" ? dash.to : ""} className="rounded-ctl border border-hairline-strong px-2 py-1.5 text-xs bg-white" aria-label="To" />
            <button type="submit" className={chip(preset === "custom") + " border border-hairline-strong bg-white"}>Custom</button>
          </form>
          {brands.length > 1 && (
            <div className="inline-flex rounded-ctl border border-hairline-strong p-0.5 bg-white">
              {([""] as (BrandKey | "")[]).concat(brands).map((b) => (
                <Link key={b || "all"} href={preset === "custom" ? `/admin/billing?tab=dashboard&range=custom&from=${dash.from}&to=${dash.to}${b ? `&brand=${b}` : ""}` : base(preset, b)} className={chip(brand === b)}>
                  {b ? BRAND_LABEL[b] : "Both brands"}
                </Link>
              ))}
            </div>
          )}
        </div>
        <a href={exportHref} className="inline-flex items-center justify-center rounded-ctl bg-white text-ink-700 border border-hairline-strong hover:border-ink-400 text-xs font-semibold px-3 py-2 self-start">
          Export CSV
        </a>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 border border-hairline rounded-card bg-white shadow-elev-1 divide-x divide-y sm:divide-y-0 divide-hairline">
        {[
          ["Invoiced", dash.totals.invoiced, "in range"],
          ["Paid", dash.totals.paid, "in range"],
          ["Outstanding", dash.totals.outstanding, "now"],
          ["Overdue", dash.totals.overdue, "now"],
        ].map(([k, v, sub]) => (
          <div key={k as string} className="px-5 py-4">
            <p className="label-caps">{k}</p>
            <p className="text-2xl font-light tabular-nums text-ink-900 mt-1">{fmtMoney(v as number)}</p>
            <p className="text-small text-ink-400">{sub}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader
          title="By period"
          description={`${fmtDate(dash.from)} – ${fmtDate(dash.to)} · by ${dash.group}`}
          action={
            <div className="hidden sm:flex items-center gap-3">
              {SERIES.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5 text-small text-ink-500"><span className={`h-2 w-2 rounded-sm ${s.dot}`} />{s.label}</span>
              ))}
            </div>
          }
        />
        <CardBody>
          <Chart dash={dash} />
          <div className="sm:hidden flex flex-wrap gap-3 mt-2">
            {SERIES.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-small text-ink-500"><span className={`h-2 w-2 rounded-sm ${s.dot}`} />{s.label}</span>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <SumTable title="Outstanding by client" rows={dash.outstandingByClient} empty="Nothing outstanding." />
        <SumTable title="Overdue by client" rows={dash.overdueByClient} late empty="Nothing overdue." />
        <SumTable title="Paid by client" rows={dash.paidByClient} empty="No payments in this range." />
      </div>
    </div>
  );
}
