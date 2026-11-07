import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError } from "@/lib/books/api";
import { loadInvoice, recalcInvoice } from "@/lib/books/invoices";
import { todayET } from "@/lib/books/types";

export const runtime = "nodejs";

// POST — a new draft with the same client, boat, brand, note and lines;
// dated today, due on receipt (the due date is set when it's sent). A copy of
// a test invoice is a test invoice too.
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
      issue_date: issue,
      terms_days: 0,
      due_date: null,
      ...(src.is_test ? { is_test: true } : {}),
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
  if (r.bundle.lines.length) {
    const { error: lErr } = await admin.from("billing_invoice_lines").insert(
      r.bundle.lines.map((l, i) => ({
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
