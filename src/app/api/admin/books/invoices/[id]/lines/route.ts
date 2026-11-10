import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError } from "@/lib/books/api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadInvoice, recalcInvoice } from "@/lib/books/invoices";
import { lineRows } from "@/lib/books/invoiceInput";
import { editEnvelopeOf, linesChangeSummary, probeEdit, recordEdit, type EditEnvelope } from "@/lib/books/invoiceEdits";
import { cancelOpenCheckouts } from "@/lib/books/onlinePayments";
import { calcInvoice } from "@/lib/books/totals";
import { EDITS_NOT_READY, LOCKED_MESSAGE, canEditWithReason, fmtMoney, fmtPct, isLockedInvoice, type InvoiceLine } from "@/lib/books/types";

export const runtime = "nodejs";

/**
 * PUT — replace every line (the editor sends the whole list). Lines are
 * snapshots of the catalog at the time they're added; editing the catalog
 * later never changes them. Only the owner sets a line's tax: for anyone
 * else a catalog line keeps the item's setting and a custom line is exempt.
 * The card-fee line's amount is worked out by billing_recalc_invoice, and
 * it's dropped when the invoice's "Offer Pay online" is off.
 *
 * Edit with a reason (20261109b): a sent / part-paid invoice's lines may be
 * replaced when the body carries edit_reason + edit_id (see invoiceEdits.ts);
 * paid / void stay locked. The new total may not go below the payments
 * already recorded — checked before anything is written, and again after the
 * recalc (old lines restored if it somehow did). An open Stripe / PayPal
 * checkout for the old amount is cancelled afterwards (best-effort).
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

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  let edit: { env: EditEnvelope; existing: { id: string; invoice_id: string; changes: string | null } | null } | null = null;
  if (isLockedInvoice(inv)) {
    if (inv.status === "paid") return bad("This invoice is paid, so it can't be edited.", 409);
    if (inv.status === "void") return bad("This invoice is void, so it can't be edited.", 409);
    const env = editEnvelopeOf(body);
    if (!env || !canEditWithReason(inv)) return bad(LOCKED_MESSAGE, 409);
    if ("error" in env) return bad(env.error);
    const probe = await probeEdit(admin, env.editId, inv.id);
    if ("error" in probe) return bad(probe.error, 500);
    if (!probe.ready) return NextResponse.json({ error: EDITS_NOT_READY, notReady: true }, { status: 503 });
    edit = { env, existing: probe.existing };
  }

  const parsed = lineRows(body?.lines);
  if (parsed.error) return bad(parsed.error);
  // "Offer Pay online" off (20261109): no card fee on a check / Zelle / Venmo-only invoice.
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

  // Part-paid guard: the total can't go below what's already been paid. Checked before writing.
  const paid = Math.round(r.bundle.payments.reduce((sum, p) => sum + Number(p.amount || 0), 0) * 100) / 100;
  const tooLow = (total: number) => paid > 0 && total < paid - 0.005;
  const guardMessage = `This invoice already has ${fmtMoney(paid)} in payments — the total can't go below that. Remove or refund a payment first.`;
  if (tooLow(calcInvoice(lines, inv.tax_rate, inv.card_fee_rate).total)) return bad(guardMessage, 409);

  const { error: delErr } = await admin.from("billing_invoice_lines").delete().eq("invoice_id", inv.id);
  if (delErr) return dbError(delErr);
  if (lines.length) {
    const { error: insErr } = await admin.from("billing_invoice_lines").insert(lines.map((l) => ({ ...l, invoice_id: inv.id })));
    if (insErr) {
      // Don't leave the invoice with no lines: put the saved ones back.
      await restoreLines(admin, inv.id, r.bundle.lines);
      return dbError(insErr);
    }
  }
  await admin.from("billing_invoices").update({ updated_by: staff.profileId }).eq("id", inv.id);
  const rc = await recalcInvoice(admin, inv.id);
  if (rc) return bad(rc, 500);

  if (edit) {
    // Belt and braces: the database's total is the truth.
    const { data: after } = await admin.from("billing_invoices").select("total").eq("id", inv.id).maybeSingle();
    if (after && tooLow(Number((after as { total: unknown }).total))) {
      await restoreLines(admin, inv.id, r.bundle.lines);
      return bad(guardMessage, 409);
    }
    await cancelOpenCheckouts(admin, inv);
    const histErr = await recordEdit(admin, { env: edit.env, existing: edit.existing, before: inv, staff, change: linesChangeSummary(r.bundle.lines, lines) });
    if (histErr) console.warn(`[billing-edits] history row for ${inv.id} (lines) failed: ${histErr}`);
  }
  return NextResponse.json({ ok: true });
}

/** Put an invoice's previous lines back (best-effort) and recalculate. */
async function restoreLines(admin: SupabaseClient, invoiceId: string, saved: InvoiceLine[]): Promise<void> {
  try {
    await admin.from("billing_invoice_lines").delete().eq("invoice_id", invoiceId);
    if (saved.length) {
      const { error } = await admin.from("billing_invoice_lines").insert(saved.map((l) => ({ ...l, invoice_id: invoiceId })));
      if (error) console.error(`[billing-edits] restoring lines on ${invoiceId} failed: ${error.message}`);
    }
    await recalcInvoice(admin, invoiceId);
  } catch (e) {
    console.error(`[billing-edits] restoring lines on ${invoiceId} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
