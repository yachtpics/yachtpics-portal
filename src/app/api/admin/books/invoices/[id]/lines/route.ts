import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError } from "@/lib/books/api";
import { loadInvoice, recalcInvoice } from "@/lib/books/invoices";
import { lineRows } from "@/lib/books/invoiceInput";
import { LOCKED_MESSAGE, fmtPct, isLockedInvoice } from "@/lib/books/types";

export const runtime = "nodejs";

/**
 * PUT — replace every line (the editor sends the whole list). Lines are
 * snapshots of the catalog at the time they're added; editing the catalog
 * later never changes them. Only the owner sets a line's tax: for anyone
 * else a catalog line keeps the item's setting and a custom line is exempt.
 * The card-fee line's amount is worked out by billing_recalc_invoice.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const r = await loadInvoice(admin, staff, params.id);
  if ("notReady" in r) return dbError({ code: "42P01" });
  if ("notFound" in r) return bad("Invoice not found.", 404);
  if ("error" in r) return bad(r.error, 500);
  const inv = r.bundle.invoice;
  if (isLockedInvoice(inv)) return bad(LOCKED_MESSAGE, 409);

  const body = (await req.json().catch(() => null)) as { lines?: unknown } | null;
  const { lines, error } = lineRows(body?.lines);
  if (error) return bad(error);

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

  const { error: delErr } = await admin.from("billing_invoice_lines").delete().eq("invoice_id", inv.id);
  if (delErr) return dbError(delErr);
  if (lines.length) {
    const { error: insErr } = await admin.from("billing_invoice_lines").insert(lines.map((l) => ({ ...l, invoice_id: inv.id })));
    if (insErr) return dbError(insErr);
  }
  await admin.from("billing_invoices").update({ updated_by: staff.profileId }).eq("id", inv.id);
  const rc = await recalcInvoice(admin, inv.id);
  if (rc) return bad(rc, 500);
  return NextResponse.json({ ok: true });
}
