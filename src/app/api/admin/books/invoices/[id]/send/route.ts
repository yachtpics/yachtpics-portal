import { NextRequest, NextResponse } from "next/server";
import { isEmail, requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError } from "@/lib/books/api";
import { loadInvoice, recalcInvoice } from "@/lib/books/invoices";
import { buildInvoicePdf } from "@/lib/books/invoicePdf";
import { sendInvoiceEmail } from "@/lib/books/invoiceEmail";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST — send (or re-send) an invoice. Body: { to?: string, email?: boolean }.
 * The number is assigned the first time (billing_next_invoice_number, row
 * lock) and kept for every re-send. email:false = "mark as sent" without
 * emailing (handed over in person). If the email fails the invoice keeps its
 * new number but stays as it was, so Send can simply be tried again.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const first = await loadInvoice(admin, staff, params.id);
  if ("notReady" in first) return dbError({ code: "42P01" });
  if ("notFound" in first) return bad("Invoice not found.", 404);
  if ("error" in first) return bad(first.error, 500);
  let inv = first.bundle.invoice;
  if (inv.status === "void") return bad("This invoice is void.");
  if (!first.bundle.lines.length) return bad("Add at least one line first.");
  if (!inv.client_id) return bad("Pick who the invoice is for first.");

  const body = ((await req.json().catch(() => null)) ?? {}) as { to?: string; email?: boolean };
  const emailIt = body.email !== false;
  const to = (typeof body.to === "string" ? body.to : first.bundle.client?.email ?? "").trim().toLowerCase();
  if (emailIt && (!to || !isEmail(to))) return bad("Enter the email address to send it to.");

  if (!inv.number) {
    const { data: number, error } = await admin.rpc("billing_next_invoice_number", { p_owner: staff.profileId, p_brand: inv.brand });
    if (error) return dbError(error);
    const { error: upErr } = await admin.from("billing_invoices").update({ number }).eq("id", inv.id).is("number", null);
    if (upErr) return dbError(upErr);
  }
  const rc = await recalcInvoice(admin, inv.id);
  if (rc) return bad(rc, 500);

  const again = await loadInvoice(admin, staff, params.id);
  if (!("bundle" in again)) return bad("Invoice couldn't be reloaded.", 500);
  inv = again.bundle.invoice;

  if (emailIt) {
    let pdf: Uint8Array;
    try {
      pdf = await buildInvoicePdf(again.bundle);
    } catch (e) {
      return bad("The PDF couldn't be made: " + (e instanceof Error ? e.message : String(e)), 500);
    }
    const { error } = await sendInvoiceEmail(again.bundle, pdf, to, staff.profileId);
    if (error) return bad(`The email didn't go: ${error}. Invoice ${inv.number} is saved — try Send again.`, 502);
  }

  const now = new Date().toISOString();
  const { error: stErr } = await admin
    .from("billing_invoices")
    .update({
      status: inv.status === "draft" ? "sent" : inv.status,
      sent_at: inv.sent_at ?? now,
      sent_to: emailIt ? to : inv.sent_to,
      updated_by: staff.profileId,
      updated_at: now,
    })
    .eq("id", inv.id);
  if (stErr) return dbError(stErr);
  await recalcInvoice(admin, inv.id);
  return NextResponse.json({ ok: true, number: inv.number, emailed: emailIt ? to : null });
}
