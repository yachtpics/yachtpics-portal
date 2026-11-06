import { NextRequest, NextResponse } from "next/server";
import { canEditItemBrand, requireBillingStaff } from "@/lib/books/staff";
import { itemFields, ZOHO_ITEM_FIELDS } from "@/lib/books/itemInput";
import type { ItemBrand } from "@/lib/books/types";

export const runtime = "nodejs";

/**
 * Edit / retire a catalog item. Owner: anything. Non-owner: name,
 * description, rate, unit, kind of their own brand's items only — not the
 * taxable/exempt setting, the brand, or retire/reactivate.
 * Catalog edits never touch past invoices (Phase 2 snapshots lines).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const { fields, error } = itemFields(body, false);
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!Object.keys(fields).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const { data: item, error: getErr } = await admin.from("billing_items").select("id, brand, kind").eq("id", params.id).maybeSingle();
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });

  if (!canEditItemBrand(staff, item.brand as ItemBrand)) {
    return NextResponse.json({ error: "Only the owner can edit this item." }, { status: 403 });
  }
  if (!staff.isOwner) {
    if ("taxable" in fields || "tax_exempt_reason" in fields) return NextResponse.json({ error: "Only the owner can change an item's tax setting." }, { status: 403 });
    if ("active" in fields) return NextResponse.json({ error: "Only the owner can retire an item." }, { status: 403 });
    if ("brand" in fields && fields.brand !== item.brand) return NextResponse.json({ error: "Only the owner can move an item to another brand." }, { status: 403 });
    if (fields.kind === "card_fee" || item.kind === "card_fee") return NextResponse.json({ error: "Only the owner can edit the card-fee item." }, { status: 403 });
    delete fields.brand;
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { ...fields, updated_at: now, updated_by: staff.profileId };
  if ("brand" in fields) patch.brand_confirmed = true;
  if (ZOHO_ITEM_FIELDS.some((k) => k in fields)) patch.local_edited_at = now;

  const { error: upErr } = await admin.from("billing_items").update(patch).eq("id", params.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
