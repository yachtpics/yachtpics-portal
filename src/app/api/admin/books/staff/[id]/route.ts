import { NextRequest, NextResponse } from "next/server";
import { cleanText, isBrandKey, isEmail, requireBillingStaff } from "@/lib/books/staff";

export const runtime = "nodejs";

/**
 * Edit a login's billing settings (owner only): display name, card-fee rate,
 * and per brand the from-name, reply-to and phone. Which brands a login bills
 * under is not changed here (that's the migration seed) so a slip can't hand
 * Samantha the YPDesigns book.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBillingStaff({ ownerOnly: true });
  if (auth.error) return auth.error;
  const { admin } = auth;

  const body = (await req.json().catch(() => null)) as {
    display_name?: string;
    card_fee_rate?: number | string;
    brands?: { brand?: string; from_name?: string; reply_to_email?: string; phone?: string }[];
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  if ("display_name" in body) {
    const v = cleanText(body.display_name, 100);
    if (!v) return NextResponse.json({ error: "Name can't be blank." }, { status: 400 });
    patch.display_name = v;
  }
  if ("card_fee_rate" in body) {
    // Accepts 3, "3", "3%" (percent) or 0.03 (fraction).
    const raw = Number(String(body.card_fee_rate).replace(/[%\s]/g, ""));
    const rate = raw >= 1 ? raw / 100 : raw;
    if (!isFinite(rate) || rate < 0 || rate >= 0.2) return NextResponse.json({ error: "Card fee must be between 0% and 20%." }, { status: 400 });
    patch.card_fee_rate = Math.round(rate * 10000) / 10000;
  }
  if (Object.keys(patch).length) {
    patch.updated_at = now;
    const { data, error } = await admin.from("billing_staff").update(patch).eq("profile_id", params.id).select("profile_id").maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Login not found." }, { status: 404 });
  }

  const list = Array.isArray(body.brands) ? body.brands : [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (!b || !isBrandKey(b.brand)) return NextResponse.json({ error: "Unknown brand." }, { status: 400 });
    const reply = cleanText(b.reply_to_email, 254);
    if (!isEmail(reply)) return NextResponse.json({ error: "That reply-to email doesn't look right." }, { status: 400 });
    const { error } = await admin
      .from("billing_staff_brands")
      .update({ from_name: cleanText(b.from_name, 120), reply_to_email: reply ? reply.toLowerCase() : null, phone: cleanText(b.phone, 40), updated_at: now })
      .eq("profile_id", params.id)
      .eq("brand", b.brand);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
