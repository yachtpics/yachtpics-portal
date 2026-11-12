/**
 * Server-side line preparation shared by the lines PUT route and "Bill for
 * this boat" (from-listing). Takes the raw lines a request sent and returns
 * the rows to store:
 *   - validated / renumbered by lineRows (invoiceInput.ts);
 *   - no card-fee line when the invoice's "Offer Pay online" is off (20261109);
 *   - only the owner sets a line's tax: for anyone else a catalog line keeps
 *     the item's setting and a custom line is exempt;
 *   - the card-fee line is named from the invoice's rate (its amount is
 *     worked out by billing_recalc_invoice).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingStaff } from "./staff";
import { lineRows } from "./invoiceInput";
import { fmtPct, type InvoiceLine } from "./types";

export async function prepareInvoiceLines(
  admin: SupabaseClient,
  staff: BillingStaff,
  inv: { online_pay: boolean; card_fee_rate: number },
  raw: unknown
): Promise<{ lines: InvoiceLine[]; error?: string }> {
  const parsed = lineRows(raw);
  if (parsed.error) return { lines: [], error: parsed.error };
  const lines = inv.online_pay === false ? parsed.lines.filter((l) => l.kind !== "card_fee") : parsed.lines;
  lines.forEach((l, i) => { l.position = i; });

  if (!staff.isOwner) {
    const ids: string[] = [];
    lines.forEach((l) => { if (l.item_id && ids.indexOf(l.item_id) === -1) ids.push(l.item_id); });
    const tax: Record<string, boolean> = {};
    if (ids.length) {
      const { data } = await admin.from("billing_items").select("id, taxable").in("id", ids);
      (data ?? []).forEach((i: { id: string; taxable: boolean }) => { tax[i.id] = !!i.taxable; });
    }
    lines.forEach((l) => { l.taxable = l.item_id ? !!tax[l.item_id] : false; });
  }
  lines.forEach((l) => {
    if (l.kind === "card_fee") { l.name = `Credit card fee ${fmtPct(inv.card_fee_rate)}`; l.description = null; }
  });
  return { lines };
}
