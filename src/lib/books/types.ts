/**
 * Billing (Portal) — shared types and constants. Safe to import from client
 * components (no server-only imports here).
 *
 * Phase 1 = brands, staff books, shared clients, item catalog. Invoices,
 * payments, PDFs, email, Stripe, reminders, quotes and the totals graph are
 * later phases; they hang off billing_staff.profile_id as `owner_id`.
 */

export type BrandKey = "yachtpics" | "ypdesigns";
export type ItemBrand = BrandKey | "both";
export type ItemUnit = "each" | "ft";
export type ItemKind = "standard" | "card_fee" | "reimbursement" | "discount" | "deposit";
export type TaxExemptReason = "Digital Download" | "Tax Exempt";

export const BRAND_KEYS: BrandKey[] = ["yachtpics", "ypdesigns"];
export const ITEM_KINDS: ItemKind[] = ["standard", "card_fee", "reimbursement", "discount", "deposit"];
export const KIND_LABEL: Record<ItemKind, string> = {
  standard: "Standard",
  card_fee: "Card fee",
  reimbursement: "Reimbursement",
  discount: "Discount",
  deposit: "Deposit",
};
export const BRAND_LABEL: Record<ItemBrand, string> = {
  yachtpics: "YachtPics",
  ypdesigns: "YPDesigns",
  both: "Both",
};

export type BillingBrand = {
  key: BrandKey;
  display_name: string;
  legal_name: string;
  logo_url: string | null;
  accent_color: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  invoice_prefix: string;
  footer_note: string | null;
};

export type StaffBrand = {
  profile_id: string;
  brand: BrandKey;
  from_name: string | null;
  reply_to_email: string | null;
  phone: string | null;
  // Phase 2 (null until 20261107 is applied)
  invoice_prefix?: string | null;
  address?: string | null;
  payment_instructions?: string | null;
  next_number?: number | null;
};

export type BillingStaffRow = {
  profile_id: string;
  display_name: string;
  is_owner: boolean;
  card_fee_rate: number;
  active: boolean;
  default_terms_days?: number | null;
  default_note?: string | null;
  brands: StaffBrand[];
};

export type BillingClient = {
  id: string;
  display_name: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  status: "active" | "inactive";
  notes: string | null;
  broker_profile_id: string | null;
  zoho_contact_id: string | null;
  zoho_merged_ids: string[] | null;
  zoho_open_balance: number | null;
  created_at: string;
};

export type BillingItem = {
  id: string;
  brand: ItemBrand;
  name: string;
  description: string | null;
  rate: number;
  unit: ItemUnit;
  kind: ItemKind;
  taxable: boolean;
  tax_exempt_reason: TaxExemptReason | null;
  brand_confirmed: boolean;
  active: boolean;
  sort_order: number;
  zoho_item_id: string | null;
};

export type DupeGroup = {
  key: string;
  reason: "name" | "email";
  value: string;
  ids: string[];
};

/** The staff member as the browser sees them (no client handles). */
export type StaffView = {
  profileId: string;
  displayName: string;
  isOwner: boolean;
  brands: BrandKey[];
  cardFeeRate: number;
};

export const BILLING_NOT_READY =
  "Billing isn't switched on yet — the billing tables haven't been added to the database.";

// ─── Phase 2: invoices ─────────────────────────────────────────────────────

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "void";
export type LineKind = ItemKind | "custom";
export type PaymentMethod = "check" | "zelle" | "venmo" | "cash" | "card" | "bank" | "paypal" | "other";

export const PAYMENT_METHODS: PaymentMethod[] = ["check", "zelle", "venmo", "cash", "card", "bank", "paypal", "other"];
export const METHOD_LABEL: Record<PaymentMethod, string> = {
  check: "Check",
  zelle: "Zelle",
  venmo: "Venmo",
  cash: "Cash",
  card: "Card",
  bank: "Bank transfer",
  paypal: "PayPal",
  other: "Other",
};
export const STATUS_LABEL: Record<InvoiceStatus | "overdue", string> = {
  draft: "Draft",
  sent: "Sent",
  partial: "Part paid",
  paid: "Paid",
  void: "Void",
  overdue: "Overdue",
};

export type BillingInvoice = {
  id: string;
  owner_id: string;
  brand: BrandKey;
  number: string | null;
  status: InvoiceStatus;
  client_id: string | null;
  listing_id: string | null;
  boat_name: string | null;
  boat_length_ft: number | null;
  issue_date: string;
  due_date: string | null;
  terms_days: number | null;
  subtotal: number;
  discount_total: number;
  tax_rate: number;
  tax_total: number;
  card_fee_rate: number;
  card_fee_total: number;
  card_fee_waived: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  note: string | null;
  internal_note: string | null;
  sent_to: string | null;
  public_token: string;
  sent_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
  paid_at: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceLine = {
  id?: string;
  position: number;
  item_id: string | null;
  kind: LineKind;
  name: string;
  description: string | null;
  quantity: number;
  unit: ItemUnit;
  unit_price: number;
  discount_type: "amount" | "percent" | null;
  discount_value: number | null;
  taxable: boolean;
  line_subtotal?: number;
  line_discount?: number;
  line_total?: number;
};

export type BillingPayment = {
  id: string;
  invoice_id: string;
  method: PaymentMethod;
  amount: number;
  paid_on: string;
  reference: string | null;
  note: string | null;
  source: "manual" | "stripe" | "paypal";
  created_at: string;
};

export const INVOICING_NOT_READY =
  "Invoicing isn't switched on yet — the phase 2 billing migration hasn't been added to the database.";

/** Today's date in Eastern time as YYYY-MM-DD. */
export function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** YYYY-MM-DD plus n days (calendar arithmetic, no timezone drift). */
export function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Sent or part-paid with a due date before today. Computed, never stored. */
export function isOverdue(inv: { status: InvoiceStatus; due_date: string | null }, today: string = todayET()): boolean {
  return (inv.status === "sent" || inv.status === "partial") && !!inv.due_date && inv.due_date < today;
}

/** "Nov 7, 2026" from a YYYY-MM-DD date column (no timezone shift). */
export function fmtDate(date: string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date.slice(0, 10) + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function fmtMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPct(rate: number): string {
  return `${Math.round(Number(rate) * 10000) / 100}%`;
}
