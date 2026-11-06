import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError } from "@/lib/books/api";
import { loadInvoice } from "@/lib/books/invoices";

export const runtime = "nodejs";

// POST — void a sent invoice (keeps its number; totals leave the dashboard).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const r = await loadInvoice(admin, staff, params.id);
  if ("notReady" in r) return dbError({ code: "42P01" });
  if ("notFound" in r) return bad("Invoice not found.", 404);
  if ("error" in r) return bad(r.error, 500);
  const inv = r.bundle.invoice;
  if (inv.status === "void") return NextResponse.json({ ok: true });
  if (r.bundle.payments.length) return bad("Delete its payments first — an invoice with money on it can't be voided.");
  const now = new Date().toISOString();
  const { error } = await admin
    .from("billing_invoices")
    .update({ status: "void", voided_at: now, balance_due: 0, updated_by: staff.profileId, updated_at: now })
    .eq("id", inv.id)
    .eq("owner_id", staff.profileId);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
