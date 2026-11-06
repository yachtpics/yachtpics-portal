/**
 * Invoice list + dashboard numbers for ONE login's book. Books are small
 * (hundreds of invoices a year), so rows are read once and summed here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingStaff } from "./staff";
import { normInvoice } from "./invoices";
import { isOverdue, todayET, type BillingInvoice, type BrandKey, type InvoiceStatus, type PaymentMethod } from "./types";

export type ListFilters = {
  brand?: BrandKey | "";
  status?: InvoiceStatus | "overdue" | "open" | "";
  client?: string;
  from?: string;
  to?: string;
  q?: string;
};

export type InvoiceRow = BillingInvoice & { client_name: string | null; overdue: boolean };

type DbErr = { code?: string; message?: string };

async function clientNames(admin: SupabaseClient, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await admin.from("billing_clients").select("id, display_name, company_name").in("id", ids.slice(i, i + 150));
    (data ?? []).forEach((c: { id: string; display_name: string; company_name: string | null }) => {
      out[c.id] = c.display_name;
    });
  }
  return out;
}

export async function listInvoices(
  admin: SupabaseClient,
  staff: BillingStaff,
  f: ListFilters
): Promise<{ rows: InvoiceRow[]; error?: DbErr }> {
  let q = admin.from("billing_invoices").select("*").eq("owner_id", staff.profileId).in("brand", staff.brands);
  if (f.brand) q = q.eq("brand", f.brand);
  if (f.client) q = q.eq("client_id", f.client);
  if (f.from) q = q.gte("issue_date", f.from);
  if (f.to) q = q.lte("issue_date", f.to);
  if (f.status && f.status !== "overdue" && f.status !== "open") q = q.eq("status", f.status);
  if (f.status === "overdue" || f.status === "open") q = q.in("status", ["sent", "partial"]);
  const { data, error } = await q.order("issue_date", { ascending: false }).order("created_at", { ascending: false }).range(0, 4999);
  if (error) return { rows: [], error };
  const today = todayET();
  const invs = (data ?? []).map((r) => normInvoice(r as Record<string, unknown>));
  const ids: string[] = [];
  invs.forEach((i) => { if (i.client_id && ids.indexOf(i.client_id) === -1) ids.push(i.client_id); });
  const names = await clientNames(admin, ids);
  let rows: InvoiceRow[] = invs.map((i) => ({ ...i, client_name: i.client_id ? names[i.client_id] ?? null : null, overdue: isOverdue(i, today) }));
  if (f.status === "overdue") rows = rows.filter((r) => r.overdue);
  const needle = (f.q ?? "").trim().toLowerCase();
  if (needle) {
    rows = rows.filter((r) =>
      [r.number, r.boat_name, r.client_name].some((v) => (v ?? "").toLowerCase().indexOf(needle) !== -1)
    );
  }
  return { rows };
}

export type Bucket = { key: string; label: string; from: string; to: string; invoiced: number; paid: number; outstanding: number };
export type ClientSum = { clientId: string | null; name: string; amount: number; count: number; daysLate?: number };
export type Dashboard = {
  from: string;
  to: string;
  group: "month" | "quarter" | "year";
  buckets: Bucket[];
  totals: { invoiced: number; paid: number; outstanding: number; overdue: number };
  outstandingByClient: ClientSum[];
  overdueByClient: ClientSum[];
  paidByClient: ClientSum[];
};

export type RangePreset = "month" | "quarter" | "year" | "custom";

const pad = (n: number) => (n < 10 ? "0" : "") + n;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function lastDay(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m + 1, 0));
  return `${y}-${pad(m + 1)}-${pad(d.getUTCDate())}`;
}

/** The bars for a preset: last 12 months / last 8 quarters / last 5 years, or a custom range. */
export function rangeFor(preset: RangePreset, customFrom?: string, customTo?: string): { from: string; to: string; group: "month" | "quarter" | "year" } {
  const today = todayET();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  if (preset === "quarter") {
    const q = Math.floor(m / 3);
    const startQ = q - 7;
    const sy = y + Math.floor(startQ / 4);
    const sq = ((startQ % 4) + 4) % 4;
    return { from: `${sy}-${pad(sq * 3 + 1)}-01`, to: lastDay(y, q * 3 + 2), group: "quarter" };
  }
  if (preset === "year") return { from: `${y - 4}-01-01`, to: `${y}-12-31`, group: "year" };
  if (preset === "custom" && customFrom && customTo && customFrom <= customTo) {
    const months = (Number(customTo.slice(0, 4)) - Number(customFrom.slice(0, 4))) * 12 + Number(customTo.slice(5, 7)) - Number(customFrom.slice(5, 7)) + 1;
    return { from: customFrom, to: customTo, group: months <= 18 ? "month" : months <= 48 ? "quarter" : "year" };
  }
  const sm = m - 11;
  const sy = y + Math.floor(sm / 12);
  return { from: `${sy}-${pad(((sm % 12) + 12) % 12 + 1)}-01`, to: lastDay(y, m), group: "month" };
}

function bucketKey(date: string, group: "month" | "quarter" | "year"): string {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7)) - 1;
  if (group === "year") return y;
  if (group === "quarter") return `${y}-Q${Math.floor(m / 3) + 1}`;
  return `${y}-${pad(m + 1)}`;
}

function makeBuckets(from: string, to: string, group: "month" | "quarter" | "year"): Bucket[] {
  const out: Bucket[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7)) - 1;
  if (group === "quarter") m = Math.floor(m / 3) * 3;
  if (group === "year") m = 0;
  const step = group === "month" ? 1 : group === "quarter" ? 3 : 12;
  for (let guard = 0; guard < 120; guard++) {
    const start = `${y}-${pad(m + 1)}-01`;
    if (start > to) break;
    const endM = m + step - 1;
    const end = lastDay(y + Math.floor(endM / 12), endM % 12);
    const label = group === "year" ? String(y) : group === "quarter" ? `Q${m / 3 + 1} ${String(y).slice(2)}` : `${MONTHS[m]}${m === 0 ? " " + String(y).slice(2) : ""}`;
    out.push({ key: bucketKey(start, group), label, from: start < from ? from : start, to: end > to ? to : end, invoiced: 0, paid: 0, outstanding: 0 });
    m += step;
    if (m >= 12) { y += Math.floor(m / 12); m = m % 12; }
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function buildDashboard(
  admin: SupabaseClient,
  staff: BillingStaff,
  opts: { preset: RangePreset; from?: string; to?: string; brand?: BrandKey | "" }
): Promise<{ dash?: Dashboard; error?: DbErr }> {
  const range = rangeFor(opts.preset, opts.from, opts.to);
  const brands = opts.brand ? [opts.brand] : staff.brands;

  const [invRes, payRes] = await Promise.all([
    admin.from("billing_invoices").select("*").eq("owner_id", staff.profileId).in("brand", brands).in("status", ["sent", "partial", "paid"]).range(0, 9999),
    admin.from("billing_payments").select("invoice_id, amount, paid_on, method").eq("owner_id", staff.profileId).gte("paid_on", range.from).lte("paid_on", range.to).range(0, 9999),
  ]);
  if (invRes.error) return { error: invRes.error };
  if (payRes.error) return { error: payRes.error };
  const invs = (invRes.data ?? []).map((r) => normInvoice(r as Record<string, unknown>));
  const byId: Record<string, BillingInvoice> = {};
  invs.forEach((i) => { byId[i.id] = i; });
  const ids: string[] = [];
  invs.forEach((i) => { if (i.client_id && ids.indexOf(i.client_id) === -1) ids.push(i.client_id); });
  const names = await clientNames(admin, ids);
  const nameOf = (id: string | null) => (id ? names[id] ?? "Unknown client" : "No client");

  const buckets = makeBuckets(range.from, range.to, range.group);
  const bIndex: Record<string, Bucket> = {};
  buckets.forEach((b) => { bIndex[b.key] = b; });
  const today = todayET();
  const totals = { invoiced: 0, paid: 0, outstanding: 0, overdue: 0 };

  const outC: Record<string, ClientSum> = {};
  const overC: Record<string, ClientSum> = {};
  const paidC: Record<string, ClientSum> = {};
  const add = (m: Record<string, ClientSum>, id: string | null, amt: number, daysLate?: number) => {
    const k = id ?? "-";
    const cur = m[k] ?? (m[k] = { clientId: id, name: nameOf(id), amount: 0, count: 0, daysLate: 0 });
    cur.amount = r2(cur.amount + amt);
    cur.count++;
    if (daysLate != null && daysLate > (cur.daysLate ?? 0)) cur.daysLate = daysLate;
  };

  invs.forEach((i) => {
    if (i.issue_date >= range.from && i.issue_date <= range.to) {
      const b = bIndex[bucketKey(i.issue_date, range.group)];
      if (b) { b.invoiced = r2(b.invoiced + i.total); b.outstanding = r2(b.outstanding + i.balance_due); }
      totals.invoiced = r2(totals.invoiced + i.total);
    }
    // "Now" tables: every open invoice, whatever its date.
    if ((i.status === "sent" || i.status === "partial") && i.balance_due > 0) {
      totals.outstanding = r2(totals.outstanding + i.balance_due);
      add(outC, i.client_id, i.balance_due);
      if (isOverdue(i, today)) {
        const late = Math.round((Date.parse(today + "T12:00:00Z") - Date.parse((i.due_date as string) + "T12:00:00Z")) / 86400000);
        totals.overdue = r2(totals.overdue + i.balance_due);
        add(overC, i.client_id, i.balance_due, late);
      }
    }
  });
  ((payRes.data ?? []) as { invoice_id: string; amount: number; paid_on: string; method: PaymentMethod }[]).forEach((p) => {
    const inv = byId[p.invoice_id];
    if (!inv) return; // void / other brand
    const amt = Number(p.amount);
    const b = bIndex[bucketKey(p.paid_on, range.group)];
    if (b) b.paid = r2(b.paid + amt);
    totals.paid = r2(totals.paid + amt);
    add(paidC, inv.client_id, amt);
  });

  const sort = (m: Record<string, ClientSum>) => Object.keys(m).map((k) => m[k]).sort((a, b) => b.amount - a.amount);
  return {
    dash: {
      from: range.from,
      to: range.to,
      group: range.group,
      buckets,
      totals,
      outstandingByClient: sort(outC),
      overdueByClient: sort(overC).sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0)),
      paidByClient: sort(paidC),
    },
  };
}
