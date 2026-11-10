import { NextRequest, NextResponse } from "next/server";
import { isBrandKey, requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError } from "@/lib/books/api";
import { loadInvoice, recalcInvoice, updateInvoiceRow } from "@/lib/books/invoices";
import { AFTER_SEND_KEYS, headerFields } from "@/lib/books/invoiceInput";
import { LOCKED_MESSAGE, ONLINE_PAY_NOT_READY, REMINDERS_NOT_READY, TESTS_NOT_READY, isLockedInvoice, type BrandKey } from "@/lib/books/types";

export const runtime = "nodejs";

type Ctx = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const r = await loadInvoice(auth.admin, auth.staff, params.id);
  if ("notReady" in r) return dbError({ code: "42P01" });
  if ("notFound" in r) return bad("Invoice not found.", 404);
  if ("error" in r) return bad(r.error, 500);
  // The processor row (loaded for the PDF) holds the encrypted PayPal secret — never send it to the browser.
  return NextResponse.json({ ...r.bundle, settings: { ...r.bundle.settings, processor: null } });
}

// PATCH — header fields. Drafts: everything (brand only while unnumbered).
// Once sent (sent / partial / paid / void) only the internal note, a by-hand
// due date, "Pause reminders" and "Offer Pay online" may change; anything
// else is a 409 (void-only rule). "Offer Pay online" (online_pay, 20261109):
// follows the client's "Online payment" when the client changes; an explicit
// online_pay in the same body wins; not on paid / void invoices. Turning it
// off on a draft also drops the card-fee line.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const r = await loadInvoice(admin, staff, params.id);
  if ("notReady" in r) return dbError({ code: "42P01" });
  if ("notFound" in r) return bad("Invoice not found.", 404);
  if ("error" in r) return bad(r.error, 500);
  const inv = r.bundle.invoice;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("Invalid request body");
  // Terms are always "Due on receipt" now; an old client sending terms_days is ignored.
  delete body.terms_days;

  if (isLockedInvoice(inv)) {
    const blocked = Object.keys(body).filter((k) => AFTER_SEND_KEYS.indexOf(k) === -1);
    if (blocked.length) return bad(LOCKED_MESSAGE, 409);
    if (inv.status === "void" && "due_date" in body) return bad("This invoice is void.", 409);
  }
  if ("online_pay" in body && (inv.status === "paid" || inv.status === "void")) {
    return bad(inv.status === "paid" ? "This invoice is paid." : "This invoice is void.", 409);
  }

  const { fields, error } = headerFields(body, inv);
  if (error) return bad(error);

  if ("is_test" in fields) {
    if (inv.number && fields.is_test) return bad("This draft already has a number, so it can't become a test invoice.");
  }
  if ("brand" in body && body.brand !== inv.brand) {
    if (inv.status !== "draft" || inv.number) return bad("The brand can't change after the invoice is sent.");
    if (!isBrandKey(body.brand) || staff.brands.indexOf(body.brand as BrandKey) === -1) return bad("You don't bill under that brand.", 403);
    fields.brand = body.brand;
  }
  if (fields.client_id) {
    // select("*"): works before 20261109 too (then online_pay is just absent).
    const { data: c } = await admin.from("billing_clients").select("*").eq("id", fields.client_id as string).maybeSingle();
    if (!c) return bad("That client no longer exists.");
    const clientPay = (c as { online_pay?: unknown }).online_pay;
    if (fields.client_id !== inv.client_id && !("online_pay" in fields) && typeof clientPay === "boolean") fields.online_pay = clientPay;
  }
  if (!Object.keys(fields).length) return NextResponse.json({ ok: true });

  const { error: upErr, dropped } = await updateInvoiceRow(admin, inv.id, staff.profileId, {
    ...fields,
    updated_by: staff.profileId,
    updated_at: new Date().toISOString(),
  });
  if (upErr) return dbError(upErr);
  if (dropped.indexOf("is_test") !== -1) return bad(TESTS_NOT_READY, 503);
  if (dropped.indexOf("reminders_paused") !== -1) return bad(REMINDERS_NOT_READY, 503);
  if (dropped.indexOf("online_pay") !== -1 && fields.online_pay === false) return bad(ONLINE_PAY_NOT_READY, 503);
  // Off on a draft: no card fee (the lines PUT drops it too).
  if (fields.online_pay === false && inv.status === "draft") {
    const { error: feeErr } = await admin.from("billing_invoice_lines").delete().eq("invoice_id", inv.id).eq("kind", "card_fee");
    if (feeErr) return dbError(feeErr);
  }
  const rc = await recalcInvoice(admin, inv.id);
  if (rc) return bad(rc, 500);
  return NextResponse.json({ ok: true });
}

// DELETE — drafts that never got a number, and test invoices at any status
// (their payments and lines go with them). A real numbered invoice is voided instead.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const r = await loadInvoice(admin, staff, params.id);
  if ("notReady" in r) return dbError({ code: "42P01" });
  if ("notFound" in r) return bad("Invoice not found.", 404);
  if ("error" in r) return bad(r.error, 500);
  const inv = r.bundle.invoice;
  if (inv.is_test) {
    const { error: pErr } = await admin.from("billing_payments").delete().eq("invoice_id", inv.id).eq("owner_id", staff.profileId);
    if (pErr) return dbError(pErr);
    const { error: lErr } = await admin.from("billing_invoice_lines").delete().eq("invoice_id", inv.id);
    if (lErr) return dbError(lErr);
    const { error } = await admin.from("billing_invoices").delete().eq("id", inv.id).eq("owner_id", staff.profileId).eq("is_test", true);
    if (error) return dbError(error);
    return NextResponse.json({ ok: true });
  }
  if (inv.status !== "draft" || inv.number) return bad("Only an unsent draft can be deleted — void this one instead.");
  const { error } = await admin.from("billing_invoices").delete().eq("id", inv.id).eq("owner_id", staff.profileId).eq("status", "draft");
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
