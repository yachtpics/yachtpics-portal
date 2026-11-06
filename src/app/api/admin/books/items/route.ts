import { NextRequest, NextResponse } from "next/server";
import { canEditItemBrand, requireBillingStaff } from "@/lib/books/staff";
import { itemFields } from "@/lib/books/itemInput";

export const runtime = "nodejs";

/**
 * Add a catalog item. Both logins can add; a non-owner only under a brand
 * they bill (YachtPics for Samantha), never "both", and can't set tax or a
 * card-fee item — those start as exempt (Digital Download) for the owner to
 * review. Catalog changes never touch past invoices (Phase 2 snapshots line
 * data onto each invoice line).
 */
export async function POST(req: NextRequest) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const { fields, error } = itemFields(body, true);
  if (error) return NextResponse.json({ error }, { status: 400 });

  if (!canEditItemBrand(staff, fields.brand as "yachtpics")) {
    return NextResponse.json({ error: "You can only add items for your own brand." }, { status: 403 });
  }
  if (!staff.isOwner) {
    if (fields.kind === "card_fee") return NextResponse.json({ error: "Only the owner can add a card-fee item." }, { status: 403 });
    fields.taxable = false;
    fields.tax_exempt_reason = "Digital Download";
  } else if (!("taxable" in fields)) {
    fields.taxable = false;
    fields.tax_exempt_reason = "Digital Download";
  }
  delete fields.active;

  const now = new Date().toISOString();
  const { data, error: insErr } = await admin
    .from("billing_items")
    .insert({
      ...fields,
      active: true,
      brand_confirmed: true, // chosen on purpose, unlike the Zoho first pass
      sort_order: typeof fields.sort_order === "number" ? fields.sort_order : 100000,
      created_by: staff.profileId,
      updated_by: staff.profileId,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
