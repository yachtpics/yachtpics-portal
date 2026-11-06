import { NextRequest, NextResponse } from "next/server";
import { cleanText, requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError, isDate, isUuid } from "@/lib/books/api";
import { loadInvoice, recalcInvoice } from "@/lib/books/invoices";
import { PAYMENT_METHODS, todayET, type PaymentMethod } from "@/lib/books/types";

export const runtime = "nodejs";

type Ctx = { params: { id: string } };

// POST — record a manual payment. Body: { method, amount, paid_on?, reference?, note? }.
// A negative amount records a refund. Phase 3 (Stripe / PayPal) writes rows
// here with source 'stripe' | 'paypal' and then calls billing_recalc_invoice.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const r = await loadInvoice(admin, staff, params.id);
  if ("notReady" in r) return dbError({ code: "42P01" });
  if ("notFound" in r) return bad("Invoice not found.", 404);
  if ("error" in r) return bad(r.error, 500);
  const inv = r.bundle.invoice;
  if (inv.status === "draft") return bad("Send the invoice (or mark it sent) before recording a payment.");
  if (inv.status === "void") return bad("This invoice is void.");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("Invalid request body");
  const method = body.method as PaymentMethod;
  if (PAYMENT_METHODS.indexOf(method) === -1) return bad("Pick how it was paid.");
  const amount = Math.round(Number(String(body.amount ?? "").replace(/[$,\s]/g, "")) * 100) / 100;
  if (!isFinite(amount) || amount === 0 || Math.abs(amount) > 1e8) return bad("Enter the amount paid.");
  const paidOn = isDate(body.paid_on) ? (body.paid_on as string) : todayET();

  const { error } = await admin.from("billing_payments").insert({
    invoice_id: inv.id,
    owner_id: staff.profileId,
    method,
    amount,
    paid_on: paidOn,
    reference: cleanText(body.reference, 200),
    note: cleanText(body.note, 1000),
    source: "manual",
    created_by: staff.profileId,
  });
  if (error) return dbError(error);
  const rc = await recalcInvoice(admin, inv.id);
  if (rc) return bad(rc, 500);
  return NextResponse.json({ ok: true });
}

// DELETE ?paymentId= — remove a manual payment recorded by mistake.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const pid = req.nextUrl.searchParams.get("paymentId");
  if (!isUuid(pid)) return bad("Which payment?");
  const r = await loadInvoice(admin, staff, params.id);
  if ("notReady" in r) return dbError({ code: "42P01" });
  if ("notFound" in r) return bad("Invoice not found.", 404);
  if ("error" in r) return bad(r.error, 500);
  const p = r.bundle.payments.filter((x) => x.id === pid)[0];
  if (!p) return bad("Payment not found.", 404);
  if (p.source !== "manual") return bad("Card and PayPal payments are removed by refunding them, not here.");
  const { error } = await admin.from("billing_payments").delete().eq("id", pid).eq("invoice_id", r.bundle.invoice.id).eq("owner_id", staff.profileId);
  if (error) return dbError(error);
  const rc = await recalcInvoice(admin, r.bundle.invoice.id);
  if (rc) return bad(rc, 500);
  return NextResponse.json({ ok: true });
}
