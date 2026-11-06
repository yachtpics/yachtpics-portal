/**
 * Zoho CSV → import payloads for billing_import_items / billing_import_clients.
 *
 * Same mapping as scripts/books-build-seed.js (which builds the first seed);
 * keep the two identical. Used by the owner-only Settings "Re-pull from Zoho
 * CSV" upload during the Zoho wind-down.
 */
import type { ItemBrand, ItemKind, ItemUnit, TaxExemptReason } from "./types";

type Row = Record<string, string>;

export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  return rows.map((r) => {
    const o: Row = {};
    head.forEach((h, k) => { o[h] = (r[k] || "").trim(); });
    return o;
  });
}

export const normKey = (s: string | null | undefined) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

function brandOf(s: string): ItemBrand {
  const k = normKey(s).replace(/\s/g, "");
  return k === "ypdesigns" ? "ypdesigns" : k === "both" ? "both" : "yachtpics";
}

function kindOf(name: string, description: string, rate: number): ItemKind {
  const t = normKey(name + " " + description);
  if (/credit card fee/.test(t)) return "card_fee";
  if (/deposit/.test(normKey(name))) return "deposit";
  if (/discount/.test(normKey(name))) return "discount";
  if (/reimburse|airfare|hotel|parking|toll|transportation|shipping/.test(t)) return "reimbursement";
  if (rate < 0) return "discount";
  return "standard";
}

export type ItemPayload = {
  zoho_item_id: string;
  name: string;
  description: string | null;
  rate: number;
  unit: ItemUnit;
  kind: ItemKind;
  taxable: boolean;
  tax_exempt_reason: TaxExemptReason | null;
  brand: ItemBrand;
};

export type ClientPayload = {
  zoho_contact_id: string;
  display_name: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  status: "active" | "inactive";
  zoho_open_balance: number;
  zoho_created_on: string | null;
  zoho_merged_ids: string[];
};

export const ITEM_HEADERS = ["name", "rate", "zoho_item_id"];
export const CLIENT_HEADERS = ["contact_id", "contact_name", "email"];

export function hasHeaders(rows: Row[], need: string[]): boolean {
  if (!rows.length) return false;
  return need.every((h) => h in rows[0]);
}

/** One row per Zoho id (the import's ON CONFLICT can't touch a row twice). */
function firstPerKey(rows: Row[], key: string): Row[] {
  const seen: Record<string, true> = {};
  return rows.filter((r) => {
    if (!r[key] || seen[r[key]]) return false;
    seen[r[key]] = true;
    return true;
  });
}

export function mapItems(rows: Row[]): ItemPayload[] {
  return firstPerKey(rows, "zoho_item_id")
    .filter((r) => r.zoho_item_id && r.name)
    .map((r) => {
      const rate = Number(r.rate || 0) || 0;
      const taxable = normKey(r.taxable) === "yes" || normKey(r.taxable) === "true";
      const ex = normKey(r.zoho_exemption);
      return {
        zoho_item_id: r.zoho_item_id,
        name: r.name,
        description: r.description || null,
        rate,
        unit: normKey(r.unit) === "ft" ? "ft" : "each", // Zoho blank and "1" both mean each
        kind: kindOf(r.name, r.description || "", rate),
        taxable,
        tax_exempt_reason: taxable ? null : ex === "digital download" ? "Digital Download" : ex ? "Tax Exempt" : null,
        brand: brandOf(r.suggested_brand || ""),
      };
    });
}

export function mapClients(rows: Row[]): { clients: ClientPayload[]; merged: number } {
  const all: ClientPayload[] = firstPerKey(rows, "contact_id")
    .filter((r) => r.contact_id && r.contact_name)
    .map((r) => {
      const bal = Number(r.outstanding_receivable_amount || 0);
      return {
        zoho_contact_id: r.contact_id,
        display_name: r.contact_name,
        company_name: r.company_name || null,
        first_name: r.first_name || null,
        last_name: r.last_name || null,
        email: r.email ? r.email.trim().toLowerCase() : null,
        phone: r.phone || null,
        mobile: r.mobile || null,
        status: normKey(r.status) === "inactive" ? "inactive" : "active",
        zoho_open_balance: isFinite(bal) ? bal : 0,
        zoho_created_on: /^\d{4}-\d{2}-\d{2}$/.test(r.created_date || "") ? r.created_date : null,
        zoho_merged_ids: [],
      };
    });

  // Exact duplicates only (same normalized name AND email): the earliest wins.
  const day = (c: ClientPayload) => c.zoho_created_on || "9999";
  all.sort((a, b) => (day(a) < day(b) ? -1 : day(a) > day(b) ? 1 : a.zoho_contact_id < b.zoho_contact_id ? -1 : 1));
  const byKey: Record<string, ClientPayload> = {};
  const out: ClientPayload[] = [];
  let merged = 0;
  all.forEach((c) => {
    if (!c.email) { out.push(c); return; }
    const key = normKey(c.display_name) + "|" + normKey(c.email);
    const keep = byKey[key];
    if (!keep) { byKey[key] = c; out.push(c); return; }
    merged++;
    keep.zoho_merged_ids.push(c.zoho_contact_id);
    if (!keep.company_name && c.company_name) keep.company_name = c.company_name;
    if (!keep.first_name && c.first_name) keep.first_name = c.first_name;
    if (!keep.last_name && c.last_name) keep.last_name = c.last_name;
    if (!keep.phone && c.phone) keep.phone = c.phone;
    if (!keep.mobile && c.mobile) keep.mobile = c.mobile;
    keep.zoho_open_balance = Math.round((keep.zoho_open_balance + c.zoho_open_balance) * 100) / 100;
    if (c.status === "active") keep.status = "active";
  });
  return { clients: out, merged };
}
