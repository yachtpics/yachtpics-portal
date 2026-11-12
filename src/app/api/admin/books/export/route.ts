import { NextRequest, NextResponse } from "next/server";
import { isBrandKey, requireBillingStaff } from "@/lib/books/staff";
import { dbError, isDate, toCsv } from "@/lib/books/api";
import { listInvoices } from "@/lib/books/reports";
import { BRAND_LABEL, METHOD_LABEL, paymentSourceLabel, settledTotal, STATUS_LABEL, todayET, type BrandKey, type PaymentMethod } from "@/lib/books/types";

export const runtime = "nodejs";

/**
 * GET ?from=&to=&brand= — one CSV for this login's book: a row per invoice
 * issued in the range (void ones included, marked), then a row per payment
 * received in the range with its method. Test invoices (and their
 * payments) are left out unless &tests=1.
 */
export async function GET(req: NextRequest) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const sp = req.nextUrl.searchParams;
  const from = isDate(sp.get("from")) ? (sp.get("from") as string) : "2000-01-01";
  const to = isDate(sp.get("to")) ? (sp.get("to") as string) : todayET();
  const brand = isBrandKey(sp.get("brand")) && staff.brands.indexOf(sp.get("brand") as BrandKey) !== -1 ? (sp.get("brand") as BrandKey) : "";

  const all = await listInvoices(admin, staff, { brand, tests: sp.get("tests") === "1" });
  if (all.error) return dbError(all.error);
  const byId: Record<string, (typeof all.rows)[number]> = {};
  all.rows.forEach((r) => { byId[r.id] = r; });

  const { data: pays, error } = await admin
    .from("billing_payments")
    .select("invoice_id, method, amount, paid_on, reference, note, source")
    .eq("owner_id", staff.profileId)
    .gte("paid_on", from)
    .lte("paid_on", to)
    .order("paid_on")
    .range(0, 9999);
  if (error) return dbError(error);

  const head = ["Record", "Number", "Brand", "Status", "Client", "Boat", "Issue date", "Due date", "Subtotal", "Discounts", "Tax", "Card fee", "Card fee waived", "Total", "Paid", "Balance due", "Payment date", "Method", "Amount", "Reference", "Note"];
  const rows: unknown[][] = [];
  all.rows
    .filter((r) => r.status !== "draft" && r.issue_date >= from && r.issue_date <= to)
    .sort((a, b) => (a.issue_date < b.issue_date ? -1 : 1))
    .forEach((r) => rows.push([r.is_test ? "Test invoice" : "Invoice", r.is_test ? "TEST" : r.number, BRAND_LABEL[r.brand], r.overdue ? "Overdue" : STATUS_LABEL[r.status], r.client_name, r.boat_name, r.issue_date, r.due_date, r.subtotal, r.discount_total, r.tax_total, r.card_fee_total, r.card_fee_waived || 0, settledTotal(r), r.amount_paid, r.status === "void" ? 0 : r.balance_due, "", "", "", "", ""]));
  ((pays ?? []) as { invoice_id: string; method: PaymentMethod; amount: number; paid_on: string; reference: string | null; note: string | null; source: string }[]).forEach((p) => {
    const inv = byId[p.invoice_id];
    if (!inv) return;
    rows.push(["Payment", inv.number, BRAND_LABEL[inv.brand], STATUS_LABEL[inv.status], inv.client_name, inv.boat_name, inv.issue_date, inv.due_date, "", "", "", "", "", "", "", "", p.paid_on, METHOD_LABEL[p.method] + (p.source !== "manual" ? ` ${paymentSourceLabel(p.source)}` : ""), Number(p.amount), p.reference, p.note]);
  });

  return new NextResponse(toCsv(head, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="invoices-${from}-to-${to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
