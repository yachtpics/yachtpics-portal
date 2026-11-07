/**
 * Billing phase 2 — server helpers for invoices. Every read is scoped to the
 * login's own book (owner_id); the public /inv page reads by token instead.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingBillingTable, type BillingStaff } from "./staff";
import { type BillingBrand, type BillingClient, type BillingInvoice, type BillingPayment, type BrandKey, type InvoiceLine } from "./types";

export const INVOICE_COLS = "*";

export type InvoiceSettings = {
  displayName: string;
  fromName: string | null;
  replyTo: string | null;
  phone: string | null;
  address: string | null;
  paymentInstructions: string | null;
};

export type InvoiceBundle = {
  invoice: BillingInvoice;
  lines: InvoiceLine[];
  payments: BillingPayment[];
  client: BillingClient | null;
  brand: BillingBrand;
  settings: InvoiceSettings;
};

const num = (v: unknown) => (v == null ? 0 : Number(v));

export function normInvoice(r: Record<string, unknown>): BillingInvoice {
  const i = r as unknown as BillingInvoice;
  return {
    ...i,
    boat_length_ft: r.boat_length_ft == null ? null : Number(r.boat_length_ft),
    subtotal: num(r.subtotal),
    discount_total: num(r.discount_total),
    tax_rate: num(r.tax_rate),
    tax_total: num(r.tax_total),
    card_fee_rate: num(r.card_fee_rate),
    card_fee_total: num(r.card_fee_total),
    card_fee_waived: num(r.card_fee_waived),
    total: num(r.total),
    amount_paid: num(r.amount_paid),
    balance_due: num(r.balance_due),
    view_count: num(r.view_count),
    due_date_manual: r.due_date_manual === true,
    is_test: r.is_test === true,
  };
}

/** Columns added by 20261107b — written only once that migration is applied. */
export const TERMS_MIGRATION_COLS = ["due_date_manual", "is_test"];

/** Unknown column (PostgREST schema cache or Postgres): the migration isn't applied yet. */
export function isMissingColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  return /column .* (does not exist|could not find)|could not find the .* column/i.test(err.message ?? "");
}

/**
 * Update one invoice row. If 20261107b isn't applied yet, the new columns
 * (due_date_manual / is_test) are dropped and the rest is saved, so the
 * editor keeps working. Returns the error, if any, and whether columns were dropped.
 */
export async function updateInvoiceRow(
  admin: SupabaseClient,
  id: string,
  ownerId: string,
  fields: Record<string, unknown>
): Promise<{ error: { code?: string; message?: string } | null; dropped: string[] }> {
  const first = await admin.from("billing_invoices").update(fields).eq("id", id).eq("owner_id", ownerId);
  if (!first.error || !isMissingColumn(first.error)) return { error: first.error, dropped: [] };
  const rest: Record<string, unknown> = {};
  const dropped: string[] = [];
  Object.keys(fields).forEach((k) => {
    if (TERMS_MIGRATION_COLS.indexOf(k) !== -1) dropped.push(k);
    else rest[k] = fields[k];
  });
  if (!dropped.length) return { error: first.error, dropped };
  const again = await admin.from("billing_invoices").update(rest).eq("id", id).eq("owner_id", ownerId);
  return { error: again.error, dropped };
}

function normLine(r: Record<string, unknown>): InvoiceLine {
  return {
    ...(r as unknown as InvoiceLine),
    quantity: num(r.quantity),
    unit_price: num(r.unit_price),
    discount_value: r.discount_value == null ? null : Number(r.discount_value),
    line_subtotal: num(r.line_subtotal),
    line_discount: num(r.line_discount),
    line_total: num(r.line_total),
  };
}

/** Can this login touch this invoice? Own book AND a brand they bill under. */
export function ownsInvoice(staff: BillingStaff, inv: { owner_id: string; brand: string }): boolean {
  return inv.owner_id === staff.profileId && staff.brands.indexOf(inv.brand as BrandKey) !== -1;
}

/** The per-login, per-brand details printed on an invoice (falls back to the brand). */
export async function loadSettings(admin: SupabaseClient, ownerId: string, brand: BillingBrand): Promise<InvoiceSettings> {
  const [{ data: s }, { data: sb }] = await Promise.all([
    admin.from("billing_staff").select("*").eq("profile_id", ownerId).maybeSingle(),
    admin.from("billing_staff_brands").select("*").eq("profile_id", ownerId).eq("brand", brand.key).maybeSingle(),
  ]);
  const row = (sb ?? {}) as Record<string, string | null>;
  return {
    displayName: ((s as Record<string, string> | null)?.display_name as string) ?? brand.display_name,
    fromName: row.from_name ?? null,
    replyTo: row.reply_to_email ?? brand.email ?? null,
    phone: row.phone ?? brand.phone ?? null,
    address: row.address || brand.address || null,
    paymentInstructions: row.payment_instructions ?? null,
  };
}

type Loaded = { bundle: InvoiceBundle } | { notReady: true } | { notFound: true } | { error: string };

async function finish(admin: SupabaseClient, inv: BillingInvoice): Promise<Loaded> {
  const [lines, payments, client, brand] = await Promise.all([
    admin.from("billing_invoice_lines").select("*").eq("invoice_id", inv.id).order("position"),
    admin.from("billing_payments").select("*").eq("invoice_id", inv.id).order("paid_on").order("created_at"),
    inv.client_id ? admin.from("billing_clients").select("*").eq("id", inv.client_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    admin.from("billing_brands").select("*").eq("key", inv.brand).maybeSingle(),
  ]);
  if (lines.error) return { error: lines.error.message };
  if (!brand.data) return { error: "Brand missing." };
  const settings = await loadSettings(admin, inv.owner_id, brand.data as BillingBrand);
  return {
    bundle: {
      invoice: inv,
      lines: (lines.data ?? []).map((l) => normLine(l as Record<string, unknown>)),
      payments: ((payments.data ?? []) as BillingPayment[]).map((p) => ({ ...p, amount: Number(p.amount) })),
      client: (client.data as BillingClient | null) ?? null,
      brand: brand.data as BillingBrand,
      settings,
    },
  };
}

export async function loadInvoice(admin: SupabaseClient, staff: BillingStaff, id: string): Promise<Loaded> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { notFound: true };
  const { data, error } = await admin.from("billing_invoices").select(INVOICE_COLS).eq("id", id).maybeSingle();
  if (error) return isMissingBillingTable(error) ? { notReady: true } : { error: error.message };
  if (!data) return { notFound: true };
  const inv = normInvoice(data as Record<string, unknown>);
  if (!ownsInvoice(staff, inv)) return { notFound: true };
  return finish(admin, inv);
}

export async function loadInvoiceByToken(admin: SupabaseClient, token: string): Promise<Loaded> {
  if (!/^[0-9a-f]{20,64}$/i.test(token)) return { notFound: true };
  const { data, error } = await admin.from("billing_invoices").select(INVOICE_COLS).eq("public_token", token).maybeSingle();
  if (error) return isMissingBillingTable(error) ? { notReady: true } : { error: error.message };
  if (!data || (data as { status: string }).status === "draft") return { notFound: true };
  return finish(admin, normInvoice(data as Record<string, unknown>));
}

export async function recalcInvoice(admin: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await admin.rpc("billing_recalc_invoice", { inv: id });
  return error ? error.message : null;
}

export const PORTAL_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://portal.yachtpics.com").replace(/\/+$/, "");

export function publicInvoiceUrl(token: string): string {
  return `${PORTAL_ORIGIN}/inv/${token}`;
}

/** PDF file name: "YP-1001 YachtPics.pdf" (drafts: "Draft …", tests: "TEST …"). */
export function pdfFileName(inv: BillingInvoice, brand: BillingBrand): string {
  const label = inv.is_test ? "TEST invoice" : inv.number ?? "Draft invoice";
  const base = `${label} ${brand.display_name}`.replace(/[^A-Za-z0-9 ._-]+/g, "").trim();
  return `${base || "Invoice"}.pdf`;
}

/** Who the invoice is for, in one short phrase (boat first, else client). */
export function invoiceSubjectLine(b: InvoiceBundle): string {
  return b.invoice.boat_name || b.client?.company_name || b.client?.display_name || "";
}
