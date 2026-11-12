"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { BRAND_LABEL, dateET, fmtDate, fmtMoney, invoiceLabel, settledTotal, type BrandKey, type InvoiceStatus, type StaffView } from "@/lib/books/types";
import type { InvoiceRow } from "@/lib/books/reports";
import { fieldClass } from "./booksApi";
import NewInvoiceButton from "./NewInvoiceButton";
import StatusBadge from "./StatusBadge";

type StatusFilter = "" | InvoiceStatus | "overdue" | "open";
const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "open", label: "Unpaid" },
  { key: "overdue", label: "Overdue" },
  { key: "partial", label: "Part paid" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
];
const PAGE = 50;

/** "Nov 7" from a YYYY-MM-DD date (no timezone shift). */
function fmtShort(date: string | null): string {
  if (!date) return "";
  return new Date(date.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Has the client opened the invoice link? Drafts / never sent → "—". */
function ViewedCell({ r }: { r: InvoiceRow }) {
  if (r.status === "draft" || !r.sent_at) return <span className="text-ink-300">—</span>;
  if (!r.view_count) return <Badge tone="neutral">Not viewed</Badge>;
  const last = fmtShort(dateET(r.last_viewed_at));
  const first = fmtShort(dateET(r.first_viewed_at));
  const title = `Opened ${r.view_count} time${r.view_count === 1 ? "" : "s"}${first ? `, first ${first}` : ""}`;
  return <span className="text-ink-600" title={title}>Viewed{last ? ` · ${last}` : ""}</span>;
}

export default function InvoicesPanel({ rows, staff, defaultBrand }: { rows: InvoiceRow[]; staff: StaffView; defaultBrand: BrandKey }) {
  const [brand, setBrand] = useState<BrandKey | "">("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [client, setClient] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [showTests, setShowTests] = useState(false);
  const testCount = useMemo(() => rows.filter((r) => r.is_test).length, [rows]);
  const base = useMemo(() => (showTests ? rows : rows.filter((r) => !r.is_test)), [rows, showTests]);

  const clients = useMemo(() => {
    const m: Record<string, string> = {};
    rows.forEach((r) => { if (r.client_id && r.client_name) m[r.client_id] = r.client_name; });
    return Object.keys(m).map((id) => ({ id, name: m[id] })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return base.filter((r) => {
      if (brand && r.brand !== brand) return false;
      if (status === "overdue" && !r.overdue) return false;
      if (status === "open" && r.status !== "sent" && r.status !== "partial") return false;
      if (status && status !== "overdue" && status !== "open" && r.status !== status) return false;
      if (client && r.client_id !== client) return false;
      if (from && r.issue_date < from) return false;
      if (to && r.issue_date > to) return false;
      if (needle && ![r.number, r.boat_name, r.client_name].some((v) => (v ?? "").toLowerCase().indexOf(needle) !== -1)) return false;
      return true;
    });
  }, [base, brand, status, client, from, to, q]);

  const sums = useMemo(() => {
    let invoiced = 0, paid = 0, due = 0;
    filtered.forEach((r) => {
      // Test invoices never count toward money totals, even when shown.
      if (r.status === "void" || r.status === "draft" || r.is_test) return;
      invoiced += settledTotal(r); // a waived card fee isn't revenue
      paid += r.amount_paid;
      due += r.balance_due;
    });
    return { invoiced, paid, due };
  }, [filtered]);

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-[6px] text-xs font-semibold whitespace-nowrap transition-colors duration-base ease-quiet ${active ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-900"}`;

  return (
    <Card>
      <CardHeader
        title="Invoices"
        kicker={`${staff.displayName}'s book`}
        description={`${filtered.length} of ${base.length}`}
        action={<NewInvoiceButton brand={brand || defaultBrand} size="sm" />}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-ctl border border-hairline-strong p-0.5 overflow-x-auto max-w-full">
            {STATUS_CHIPS.map((c) => (
              <button key={c.key || "all"} type="button" className={chip(status === c.key)} onClick={() => { setStatus(c.key); setShown(PAGE); }}>{c.label}</button>
            ))}
          </div>
          {testCount > 0 && (
            <label className="inline-flex items-center gap-2 text-small text-ink-500 px-1">
              <input type="checkbox" className="h-3.5 w-3.5 accent-[#c39e4e]" checked={showTests} onChange={(e) => { setShowTests(e.target.checked); setShown(PAGE); }} />
              Show tests ({testCount})
            </label>
          )}
          {staff.brands.length > 1 && (
            <div className="inline-flex rounded-ctl border border-hairline-strong p-0.5">
              {([""] as (BrandKey | "")[]).concat(staff.brands).map((b) => (
                <button key={b || "all"} type="button" className={chip(brand === b)} onClick={() => setBrand(b)}>{b ? BRAND_LABEL[b] : "Both brands"}</button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input className={fieldClass} placeholder="Search number, client, boat" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
          <select className={fieldClass} value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-small text-ink-500">From<input type="date" className={fieldClass} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="flex items-center gap-2 text-small text-ink-500">To<input type="date" className={fieldClass} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>

        <div className="grid grid-cols-3 border border-hairline rounded-card divide-x divide-hairline">
          {[["Invoiced", sums.invoiced], ["Paid", sums.paid], ["Balance due", sums.due]].map(([k, v]) => (
            <div key={k as string} className="px-3 sm:px-5 py-3">
              <p className="label-caps">{k}</p>
              <p className="text-lg sm:text-xl font-light tabular-nums text-ink-900">{fmtMoney(v as number)}</p>
            </div>
          ))}
        </div>

        {base.length === 0 ? (
          <p className="text-sm text-ink-500 py-6">No invoices yet. Start one with New invoice.</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-ink-500 py-6">Nothing matches.</p>
        ) : (
          <ul className="divide-y divide-hairline border-y border-hairline">
            {filtered.slice(0, shown).map((r) => (
              <li key={r.id}>
                <Link href={`/admin/billing/invoices/${r.id}`} className="flex items-start justify-between gap-3 py-3 px-1 hover:bg-ink-50 transition-colors duration-base ease-quiet rounded-ctl">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink-900 tabular-nums">{invoiceLabel(r)}</span>
                      <StatusBadge status={r.status} overdue={r.overdue} />
                      {staff.brands.length > 1 && <span className="text-small text-ink-400">{BRAND_LABEL[r.brand]}</span>}
                    </div>
                    <p className="text-small text-ink-600 mt-0.5 truncate">{[r.client_name ?? "No client yet", r.boat_name].filter(Boolean).join(" · ")}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-small text-ink-400">
                      <span>
                        {fmtDate(r.issue_date)}{r.due_date && r.status !== "paid" && r.status !== "void" && r.status !== "draft" ? ` · due ${fmtDate(r.due_date)}` : ""}
                        {r.last_reminder_at ? ` · Reminder sent ${fmtDate(dateET(r.last_reminder_at))}` : ""}
                        {r.reminders_paused && (r.status === "sent" || r.status === "partial") ? " · reminders paused" : ""}
                      </span>
                      <span className="whitespace-nowrap"><ViewedCell r={r} /></span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm tabular-nums text-ink-900">{fmtMoney(r.status === "paid" && r.card_fee_waived > 0 ? settledTotal(r) : r.total)}</p>
                    {r.status === "paid" && r.card_fee_waived > 0 && (
                      <p className="text-small tabular-nums text-ink-500">{fmtMoney(r.card_fee_waived)} card fee waived</p>
                    )}
                    {r.status !== "paid" && r.status !== "void" && r.status !== "draft" && r.balance_due !== r.total && (
                      <p className="text-small tabular-nums text-ink-500">{fmtMoney(r.balance_due)} due</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {filtered.length > shown && (
          <button type="button" className="text-sm text-accent-700 hover:underline" onClick={() => setShown(shown + PAGE)}>Show more ({filtered.length - shown} left)</button>
        )}
      </CardBody>
    </Card>
  );
}
