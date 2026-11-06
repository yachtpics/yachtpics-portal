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
};

export type BillingStaffRow = {
  profile_id: string;
  display_name: string;
  is_owner: boolean;
  card_fee_rate: number;
  active: boolean;
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
