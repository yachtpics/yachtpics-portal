import { NextRequest, NextResponse } from "next/server";
import { isBrandKey, requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError, isDate, isUuid } from "@/lib/books/api";
import { listInvoices, type ListFilters } from "@/lib/books/reports";
import { todayET, type BrandKey } from "@/lib/books/types";

export const runtime = "nodejs";

// GET — this login's invoices. ?brand=&status=(draft|sent|partial|paid|void|overdue|open)&client=&from=&to=&q=&tests=1 (include test invoices)
export async function GET(req: NextRequest) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const sp = req.nextUrl.searchParams;
  const f: ListFilters = {
    brand: isBrandKey(sp.get("brand")) ? (sp.get("brand") as BrandKey) : "",
    status: (sp.get("status") ?? "") as ListFilters["status"],
    client: isUuid(sp.get("client")) ? (sp.get("client") as string) : undefined,
    from: isDate(sp.get("from")) ? (sp.get("from") as string) : undefined,
    to: isDate(sp.get("to")) ? (sp.get("to") as string) : undefined,
    q: sp.get("q") ?? undefined,
    tests: sp.get("tests") === "1",
  };
  const { rows, error } = await listInvoices(auth.admin, auth.staff, f);
  if (error) return dbError(error);
  return NextResponse.json({ invoices: rows });
}

// POST — a new draft in this login's book. Body: { brand?, client_id?, listing_id?, boat_name?, boat_length_ft? }
export async function POST(req: NextRequest) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  const brand = (isBrandKey(body.brand) ? body.brand : staff.brands[0]) as BrandKey;
  if (staff.brands.indexOf(brand) === -1) return bad("You don't bill under that brand.", 403);

  const [{ data: s, error: sErr }, { data: tax }] = await Promise.all([
    admin.from("billing_staff").select("*").eq("profile_id", staff.profileId).maybeSingle(),
    admin.from("billing_tax_rates").select("rate").eq("is_default", true).eq("active", true).maybeSingle(),
  ]);
  if (sErr) return dbError(sErr);
  const sx = (s ?? {}) as Record<string, unknown>;
  // Due on receipt, always: terms 0 and no due date until it's sent (then the
  // sent date). billing_staff.default_terms_days is kept at 0 and not read.
  const issue = todayET();
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("billing_invoices")
    .insert({
      owner_id: staff.profileId,
      brand,
      status: "draft",
      client_id: isUuid(body.client_id) ? body.client_id : null,
      listing_id: isUuid(body.listing_id) ? body.listing_id : null,
      boat_name: typeof body.boat_name === "string" ? body.boat_name.slice(0, 120) : null,
      boat_length_ft: typeof body.boat_length_ft === "number" ? body.boat_length_ft : null,
      issue_date: issue,
      terms_days: 0,
      due_date: null,
      tax_rate: tax ? Number((tax as { rate: number }).rate) : 0.065,
      card_fee_rate: staff.cardFeeRate,
      note: (sx.default_note as string | null) ?? null,
      created_by: staff.profileId,
      updated_by: staff.profileId,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ ok: true, id: data.id });
}
