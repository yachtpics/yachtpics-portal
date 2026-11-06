import { cleanText, isItemBrand } from "./staff";
import { ITEM_KINDS, type ItemKind } from "./types";

/**
 * Validated item fields from a create/edit body — only keys present are
 * returned. Permission checks (who may set brand / tax / active) are done by
 * the route, not here.
 */
export function itemFields(body: Record<string, unknown>, creating: boolean): { fields: Record<string, unknown>; error?: string } {
  const f: Record<string, unknown> = {};
  if ("name" in body || creating) {
    const name = cleanText(body.name, 200);
    if (!name) return { fields: f, error: "Give the item a name." };
    f.name = name;
  }
  if ("description" in body) f.description = cleanText(body.description, 2000);
  if ("rate" in body || creating) {
    const rate = typeof body.rate === "number" ? body.rate : Number(String(body.rate ?? "").replace(/[$,\s]/g, ""));
    if (!isFinite(rate) || Math.abs(rate) > 1e8) return { fields: f, error: "The rate must be a number." };
    f.rate = Math.round(rate * 10000) / 10000;
  }
  if ("unit" in body || creating) {
    const unit = body.unit ?? "each";
    if (unit !== "each" && unit !== "ft") return { fields: f, error: "Unit must be each or per ft." };
    f.unit = unit;
  }
  if ("kind" in body || creating) {
    const kind = (body.kind ?? "standard") as ItemKind;
    if (ITEM_KINDS.indexOf(kind) === -1) return { fields: f, error: "Unknown item kind." };
    f.kind = kind;
  }
  if ("brand" in body || creating) {
    if (!isItemBrand(body.brand)) return { fields: f, error: "Pick a brand." };
    f.brand = body.brand;
  }
  if ("taxable" in body) f.taxable = body.taxable === true;
  if ("tax_exempt_reason" in body) {
    const r = body.tax_exempt_reason;
    if (r !== null && r !== "Digital Download" && r !== "Tax Exempt") return { fields: f, error: "Unknown exemption." };
    f.tax_exempt_reason = r;
  }
  if ("taxable" in f) {
    // Taxable items carry no exemption; exempt items always carry one.
    if (f.taxable) f.tax_exempt_reason = null;
    else if (!f.tax_exempt_reason) f.tax_exempt_reason = "Digital Download";
  }
  if ("active" in body) f.active = body.active === true;
  if ("sort_order" in body) {
    const n = Number(body.sort_order);
    if (isFinite(n)) f.sort_order = Math.round(n);
  }
  return { fields: f };
}

/** Fields that came from Zoho: editing any of them stops a re-pull overwriting the item. */
export const ZOHO_ITEM_FIELDS = ["name", "description", "rate", "unit", "kind", "taxable", "tax_exempt_reason"];
