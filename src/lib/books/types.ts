/**
 * Billing (Portal) — shared types and constants. Safe to import from client
 * components (no server-only imports here).
 *
 * Phase 1 = brands, staff books, shared clients, item catalog. Phase 2 =
 * invoices, lines, manual payments, PDF + email, the public /inv page, the
 * dashboard, CSV export and backups (each login's book is keyed by
 * billing_staff.profile_id as `owner_id`). Payment reminders (20261108):
 * per-login schedules, per-invoice pause, the daily billing_reminders job.
 * Online payment (20261108b): per-login processor (Stripe platform account or
 * the login's own PayPal), Pay online on /inv. Contact persons (20261108c):
 * several people per client, picked at send time. Still to come: quotes.
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
  /** "Notes" at the foot of every invoice. */
  footer_note: string | null;
  /** "Terms & Conditions" (multi-line). Undefined until 20261107b is applied. */
  terms_text?: string | null;
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
  /** Due date typed by hand (else it's the sent date). Undefined until 20261107b. */
  due_date_manual?: boolean;
  /** Test invoice: never numbered, kept out of every total. Undefined until 20261107b. */
  is_test?: boolean;
  /** No payment reminders while true ("a check is on the way"). Undefined until 20261108. */
  reminders_paused?: boolean;
  /** Last Stripe Checkout / PayPal order started from /inv. Undefined until 20261108b. */
  stripe_checkout_session_id?: string | null;
  paypal_order_id?: string | null;
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
  /** Every recipient of the last send (sent_to = the first). Undefined until 20261108c. */
  sent_to_all?: string[] | null;
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
  external_id?: string | null;
  created_at: string;
};

export const INVOICING_NOT_READY =
  "Invoicing isn't switched on yet — the phase 2 billing migration hasn't been added to the database.";

export const TESTS_NOT_READY =
  "Test invoices aren't switched on yet — the 20261107b billing migration hasn't been added to the database.";

export const LOCKED_MESSAGE = "Sent invoices can't be edited. Void it and duplicate to make changes.";

/** Sent / part paid / paid / void: lines and money are fixed (void-only rule). */
export function isLockedInvoice(inv: { status: InvoiceStatus }): boolean {
  return inv.status !== "draft";
}

/** What prints where the number goes: the number, "TEST" for a test invoice, else "Draft". */
export function invoiceLabel(inv: { number: string | null; is_test?: boolean }): string {
  if (inv.is_test) return "TEST";
  return inv.number ?? "Draft";
}

/** Payment lines: one per " · " or newline-separated piece, blanks dropped. */
export function splitPaymentLines(text: string | null | undefined): string[] {
  return (text ?? "").split(/\s+·\s+|\r?\n/).map((x) => x.trim()).filter(Boolean);
}

/**
 * The block at the foot of every invoice (PDF, public page, email), in this
 * order: Notes (brand footer_note), then Terms & Conditions — "Payment due
 * upon receipt.", the login's payment lines, the brand's terms_text.
 */
export function invoiceFooter(brand: { footer_note: string | null; terms_text?: string | null }, paymentInstructions: string | null | undefined): { notes: string[]; terms: string[] } {
  const notes = (brand.footer_note ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const terms = ["Payment due upon receipt."]
    .concat(splitPaymentLines(paymentInstructions))
    .concat((brand.terms_text ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean));
  return { notes, terms };
}

/** An ISO timestamp as an Eastern-time YYYY-MM-DD. */
export function dateET(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

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

// ─── Payment reminders (20261108) ──────────────────────────────────────────

export const REMINDERS_NOT_READY =
  "Payment reminders aren't switched on yet — the 20261108 billing migration hasn't been added to the database.";

export const REMINDER_MAX_DAY = 120;
export const REMINDER_MAX_STEPS = 10;

export type ReminderSchedule = {
  profile_id: string;
  days: number[];
  enabled: boolean;
  updated_at?: string;
};

/** Whole days from date a to date b (YYYY-MM-DD, b − a). */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a.slice(0, 10) + "T12:00:00Z");
  const tb = Date.parse(b.slice(0, 10) + "T12:00:00Z");
  return Math.round((tb - ta) / 86400000);
}

/** Whole numbers 1..120, no repeats, ascending, at most 10. Anything else is dropped. */
export function cleanReminderDays(raw: unknown): number[] {
  const out: number[] = [];
  (Array.isArray(raw) ? raw : []).forEach((v) => {
    const n = Number(v);
    if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > REMINDER_MAX_DAY) return;
    if (out.indexOf(n) === -1) out.push(n);
  });
  out.sort((a, b) => a - b);
  return out.slice(0, REMINDER_MAX_STEPS);
}

/**
 * The reminder step due now, or null. Only the LARGEST step already reached
 * counts (an invoice that was paused for a while gets one catch-up reminder,
 * not three), and nothing goes if that step — or a later one — already went.
 */
export function reminderStepDue(daysPast: number, days: number[], sentDays: number[]): number | null {
  let target: number | null = null;
  days.forEach((d) => { if (d <= daysPast && (target === null || d > target)) target = d; });
  if (target === null) return null;
  const t: number = target;
  if (sentDays.some((s) => s >= t)) return null;
  return t;
}

/**
 * When the next reminder would go for this invoice (YYYY-MM-DD, ET), or null
 * for none. A step that's already due returns today (it goes on the next
 * morning run). Ignores pause / status — the caller checks those.
 */
export function nextReminderDate(dueDate: string | null, days: number[], sentDays: number[], today: string = todayET()): string | null {
  if (!dueDate || !days.length) return null;
  const past = daysBetween(dueDate, today);
  if (reminderStepDue(past, days, sentDays) !== null) return today;
  const maxSent = sentDays.length ? Math.max.apply(null, sentDays) : 0;
  for (let i = 0; i < days.length; i++) {
    if (days[i] > past && days[i] > maxSent) return addDays(dueDate, days[i]);
  }
  return null;
}

// ─── Online payment (20261108b) ────────────────────────────────────────────

export const PROCESSORS_NOT_READY =
  "Online payments aren't switched on yet — the 20261108b billing migration hasn't been added to the database.";

/** Which account takes a login's online payments. A setting per login, not hard-coded. */
export type ProcessorKind = "stripe_platform" | "paypal";
export type PaypalEnv = "live" | "sandbox";

/** A login's processor as the browser sees it — the PayPal secret never leaves the server. */
export type ProcessorView = {
  processor: ProcessorKind;
  enabled: boolean;
  paypalClientId: string | null;
  paypalEnv: PaypalEnv;
  /** A PayPal secret is stored (shown as dots). */
  secretSaved: boolean;
  /** BILLING_SECRETS_KEY is set on the server (needed to save a PayPal secret). */
  keyConfigured: boolean;
};

/** "via Stripe" / "via PayPal" after an online payment's method; "" for manual ones. */
export function paymentSourceLabel(source: string | null | undefined): string {
  if (source === "stripe") return "via Stripe";
  if (source === "paypal") return "via PayPal";
  return "";
}

// ─── Contact persons (20261108c) ───────────────────────────────────────────

export const CONTACTS_NOT_READY =
  "Contacts aren't switched on yet — the 20261108c billing migration hasn't been added to the database.";

/** Most addresses one invoice email goes to. */
export const MAX_RECIPIENTS = 10;

/** A person at a client (Zoho's "contact person"). The primary one mirrors the client's email / phone. */
export type BillingClientContact = {
  id: string;
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  /** Free label: "Accounts payable", "Assistant". */
  role: string | null;
  is_primary: boolean;
  /** "Gets invoices" — pre-ticked in the Send dialog. */
  send_by_default: boolean;
  zoho_contact_person_id: string | null;
  created_at?: string;
  updated_at?: string;
};

export function contactName(c: { first_name: string | null; last_name: string | null }): string {
  return [c.first_name, c.last_name].filter((x) => !!x && !!String(x).trim()).join(" ").trim();
}

const RECIPIENT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who reminders and receipts go to: everyone the invoice was last sent to
 * (sent_to_all), else sent_to. Lower-cased, de-duplicated, valid only.
 */
export function invoiceRecipients(inv: { sent_to: string | null; sent_to_all?: string[] | null }): string[] {
  const raw = inv.sent_to_all && inv.sent_to_all.length ? inv.sent_to_all : inv.sent_to ? [inv.sent_to] : [];
  const out: string[] = [];
  raw.forEach((e) => {
    const v = String(e ?? "").trim().toLowerCase();
    if (RECIPIENT_RE.test(v) && out.indexOf(v) === -1) out.push(v);
  });
  return out;
}

/**
 * The first name to greet in a billing email ("Hi Angela,"), or "" for
 * "Hello,". One recipient: that contact's first name (the client's first name
 * when it's the client's own address). Several recipients: "" — they all see
 * one email, so nobody is singled out.
 */
export function greetingFirstName(
  recipients: string[],
  client: { first_name: string | null; email: string | null } | null,
  contacts: { first_name: string | null; email: string | null }[]
): string {
  if (recipients.length !== 1) return "";
  const to = recipients[0];
  const hit = contacts.filter((c) => (c.email ?? "").trim().toLowerCase() === to)[0];
  const name = hit ? hit.first_name : client && (client.email ?? "").trim().toLowerCase() === to ? client.first_name : null;
  return (name ?? "").trim().split(" ")[0];
}
