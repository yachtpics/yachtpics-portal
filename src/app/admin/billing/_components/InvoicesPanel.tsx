"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { BRAND_LABEL, fmtDate, fmtMoney, type BrandKey, type InvoiceStatus, type StaffView } from "@/lib/books/types";
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

export default function InvoicesPanel({ rows, staff, defaultBrand }: { rows: InvoiceRow[]; staff: StaffView; defaultBrand: BrandKey }) {
  const [brand, setBrand] = useState<BrandKey | "">("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [client, setClient] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  const clients = useMemo(() => {
    const m: Record<string, string> = {};
    rows.forEach((r) => { if (r.client_id && r.client_name) m[r.client_id] = r.client_name; });
    return Object.keys(m).map((id) => ({ id, name: m[id] })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
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
  }, [rows, brand, status, client, from, to, q]);

  const sums = useMemo(() => {
    let invoiced = 0, paid = 0, due = 0;
    filtered.forEach((r) => {
      if (r.status === "void" || r.status === "draft") return;
      invoiced += r.total;
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
        description={`${filtered.length} of ${rows.length}`}
        action={<NewInvoiceButton brand={brand || defaultBrand} size="sm" />}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-ctl border border-hairline-strong p-0.5 overflow-x-auto max-w-full">
            {STATUS_CHIPS.map((c) => (
              <button key={c.key || "all"} type="button" className={chip(status === c.key)} onClick={() => { setStatus(c.key); setShown(PAGE); }}>{c.label}</button>
            ))}
          </div>
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

        {rows.length === 0 ? (
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
                      <span className="text-sm font-medium text-ink-900 tabular-nums">{r.number ?? "Draft"}</span>
                      <StatusBadge status={r.status} overdue={r.overdue} />
                      {staff.brands.length > 1 && <span className="text-small text-ink-400">{BRAND_LABEL[r.brand]}</span>}
                    </div>
                    <p className="text-small text-ink-600 mt-0.5 truncate">{[r.client_name ?? "No client yet", r.boat_name].filter(Boolean).join(" · ")}</p>
                    <p className="text-small text-ink-400">{fmtDate(r.issue_date)}{r.due_date && r.status !== "paid" && r.status !== "void" && r.status !== "draft" ? ` · due ${fmtDate(r.due_date)}` : ""}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm tabular-nums text-ink-900">{fmtMoney(r.total)}</p>
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
