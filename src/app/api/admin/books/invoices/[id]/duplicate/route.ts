import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError } from "@/lib/books/api";
import { loadInvoice, recalcInvoice } from "@/lib/books/invoices";
import { todayET } from "@/lib/books/types";

export const runtime = "nodejs";

// POST — a new draft with the same client, boat, brand, note and lines;
// dated today, due on receipt (the due date is set when it's sent). A copy of
// a test invoice is a test invoice too. "Offer Pay online" comes from the
// client's current "Online payment" switch (20261109), not the source invoice;
// when that's off, the card-fee line isn't copied.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const r = await loadInvoice(admin, staff, params.id);
  if ("notReady" in r) return dbError({ code: "42P01" });
  if ("notFound" in r) return bad("Invoice not found.", 404);
  if ("error" in r) return bad(r.error, 500);
  const src = r.bundle.invoice;
  const issue = todayET();
  const now = new Date().toISOString();
  // bundle.client is select("*"): online_pay is absent before 20261109 → not written.
  const clientPay = (r.bundle.client as { online_pay?: unknown } | null)?.online_pay;
  const onlinePay = typeof clientPay === "boolean" ? clientPay : undefined;
  const srcLines = onlinePay === false ? r.bundle.lines.filter((l) => l.kind !== "card_fee") : r.bundle.lines;
  const { data, error } = await admin
    .from("billing_invoices")
    .insert({
      owner_id: staff.profileId,
      brand: src.brand,
      status: "draft",
      client_id: src.client_id,
      listing_id: src.listing_id,
      boat_name: src.boat_name,
      boat_length_ft: src.boat_length_ft,
      // Only written when the source has them (so a DB before 20261112_billing_boat_details still inserts).
      ...(src.boat_make != null || src.boat_model != null || src.boat_year != null
        ? { boat_make: src.boat_make ?? null, boat_model: src.boat_model ?? null, boat_year: src.boat_year ?? null }
        : {}),
      issue_date: issue,
      terms_days: 0,
      due_date: null,
      ...(src.is_test ? { is_test: true } : {}),
      ...(onlinePay !== undefined ? { online_pay: onlinePay } : {}),
      tax_rate: src.tax_rate,
      card_fee_rate: staff.cardFeeRate,
      note: src.note,
      internal_note: src.internal_note,
      created_by: staff.profileId,
      updated_by: staff.profileId,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (error) return dbError(error);
  if (srcLines.length) {
    const { error: lErr } = await admin.from("billing_invoice_lines").insert(
      srcLines.map((l, i) => ({
        invoice_id: data.id,
        position: i,
        item_id: l.item_id,
        kind: l.kind,
        name: l.name,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unit_price: l.unit_price,
        discount_type: l.discount_type,
        discount_value: l.discount_value,
        taxable: l.taxable,
      }))
    );
    if (lErr) return dbError(lErr);
  }
  await recalcInvoice(admin, data.id);
  return NextResponse.json({ ok: true, id: data.id });
}
