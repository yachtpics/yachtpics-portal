import { cleanText } from "./staff";
import { isDate, isUuid } from "./api";
import { addDays, type InvoiceLine, type LineKind } from "./types";

const LINE_KINDS: LineKind[] = ["standard", "card_fee", "reimbursement", "discount", "deposit", "custom"];

/** Header fields from a PATCH body (only keys present). */
export function headerFields(body: Record<string, unknown>, current: { issue_date: string; terms_days: number | null }): { fields: Record<string, unknown>; error?: string } {
  const f: Record<string, unknown> = {};
  if ("client_id" in body) {
    if (body.client_id !== null && !isUuid(body.client_id)) return { fields: f, error: "Pick a client." };
    f.client_id = body.client_id;
  }
  if ("listing_id" in body) {
    if (body.listing_id !== null && !isUuid(body.listing_id)) return { fields: f, error: "Bad boat." };
    f.listing_id = body.listing_id;
  }
  if ("boat_name" in body) f.boat_name = cleanText(body.boat_name, 120);
  if ("boat_length_ft" in body) {
    const raw = body.boat_length_ft;
    if (raw === null || raw === "") f.boat_length_ft = null;
    else {
      const n = Number(raw);
      if (!isFinite(n) || n < 0 || n > 1000) return { fields: f, error: "Boat length must be a number of feet." };
      f.boat_length_ft = Math.round(n * 100) / 100;
    }
  }
  if ("note" in body) f.note = cleanText(body.note, 4000);
  if ("internal_note" in body) f.internal_note = cleanText(body.internal_note, 4000);
  if ("issue_date" in body) {
    if (!isDate(body.issue_date)) return { fields: f, error: "Issue date isn't a date." };
    f.issue_date = body.issue_date;
  }
  if ("terms_days" in body) {
    const n = Number(body.terms_days);
    if (!isFinite(n) || n < 0 || n > 365) return { fields: f, error: "Terms must be 0–365 days." };
    f.terms_days = Math.round(n);
  }
  if ("due_date" in body) {
    if (body.due_date !== null && !isDate(body.due_date)) return { fields: f, error: "Due date isn't a date." };
    f.due_date = body.due_date;
  } else if ("issue_date" in f || "terms_days" in f) {
    const issue = (f.issue_date as string) ?? current.issue_date;
    const terms = (f.terms_days as number | undefined) ?? current.terms_days ?? 0;
    f.due_date = addDays(issue, terms);
  }
  return { fields: f };
}

/** Validated line rows (no ids, positions renumbered) from a PUT body. */
export function lineRows(raw: unknown): { lines: InvoiceLine[]; error?: string } {
  if (!Array.isArray(raw)) return { lines: [], error: "Lines missing." };
  if (raw.length > 200) return { lines: [], error: "Up to 200 lines per invoice." };
  const out: InvoiceLine[] = [];
  let fees = 0;
  for (let i = 0; i < raw.length; i++) {
    const r = (raw[i] ?? {}) as Record<string, unknown>;
    const kind = (LINE_KINDS.indexOf(r.kind as LineKind) !== -1 ? r.kind : "custom") as LineKind;
    if (kind === "card_fee") { fees++; if (fees > 1) continue; }
    const name = cleanText(r.name, 200);
    if (!name && kind !== "card_fee") return { lines: [], error: `Line ${i + 1} needs a description.` };
    const q = kind === "card_fee" ? 1 : Number(r.quantity);
    const p = kind === "card_fee" ? 0 : Number(String(r.unit_price ?? "").replace(/[$,\s]/g, ""));
    if (!isFinite(q) || Math.abs(q) > 1e6) return { lines: [], error: `Line ${i + 1}: quantity must be a number.` };
    if (!isFinite(p) || Math.abs(p) > 1e8) return { lines: [], error: `Line ${i + 1}: price must be a number.` };
    let dType: "amount" | "percent" | null = r.discount_type === "amount" || r.discount_type === "percent" ? r.discount_type : null;
    let dVal = dType ? Number(r.discount_value) : null;
    if (dType && (dVal === null || !isFinite(dVal) || dVal === 0)) { dType = null; dVal = null; }
    if (dType === "percent" && dVal !== null && (dVal < 0 || dVal > 100)) return { lines: [], error: `Line ${i + 1}: a percent discount is 0–100.` };
    out.push({
      position: out.length,
      item_id: isUuid(r.item_id) ? r.item_id : null,
      kind,
      name: name ?? "Credit card fee",
      description: cleanText(r.description, 2000),
      quantity: Math.round(q * 1000) / 1000,
      unit: r.unit === "ft" ? "ft" : "each",
      unit_price: Math.round(p * 10000) / 10000,
      discount_type: kind === "discount" || kind === "card_fee" ? null : dType,
      discount_value: kind === "discount" || kind === "card_fee" ? null : dVal,
      taxable: kind === "card_fee" ? false : r.taxable === true,
    });
  }
  return { lines: out };
}
