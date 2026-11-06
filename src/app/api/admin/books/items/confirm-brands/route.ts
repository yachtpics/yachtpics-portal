import { NextRequest, NextResponse } from "next/server";
import { isItemBrand, requireBillingStaff } from "@/lib/books/staff";
import type { ItemBrand } from "@/lib/books/types";

export const runtime = "nodejs";

// Confirm the Zoho first-pass brand split (owner only). Body: { items: [{ id, brand }] }.
// A confirmed brand is never changed by a Zoho re-pull.
export async function POST(req: NextRequest) {
  const auth = await requireBillingStaff({ ownerOnly: true });
  if (auth.error) return auth.error;
  const { admin, staff } = auth;

  const body = (await req.json().catch(() => null)) as { items?: { id?: string; brand?: string }[] } | null;
  const list = Array.isArray(body?.items) ? body!.items! : [];
  if (!list.length || list.length > 500) return NextResponse.json({ error: "Nothing to confirm." }, { status: 400 });

  const byBrand: Record<string, string[]> = {};
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it || typeof it.id !== "string" || !isItemBrand(it.brand)) return NextResponse.json({ error: "Bad item in the list." }, { status: 400 });
    (byBrand[it.brand as ItemBrand] = byBrand[it.brand as ItemBrand] || []).push(it.id);
  }

  const now = new Date().toISOString();
  const brands = Object.keys(byBrand);
  for (let i = 0; i < brands.length; i++) {
    const { error } = await admin
      .from("billing_items")
      .update({ brand: brands[i], brand_confirmed: true, updated_at: now, updated_by: staff.profileId })
      .in("id", byBrand[brands[i]]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, confirmed: list.length });
}
