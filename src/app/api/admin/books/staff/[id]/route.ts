import { NextRequest, NextResponse } from "next/server";
import { cleanText, isBrandKey, isEmail, requireBillingStaff } from "@/lib/books/staff";
import { dbError } from "@/lib/books/api";

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
    default_terms_days?: number | string;
    default_note?: string;
    brands?: {
      brand?: string; from_name?: string; reply_to_email?: string; phone?: string;
      invoice_prefix?: string; address?: string; payment_instructions?: string; next_number?: number | null;
    }[];
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
  if ("default_terms_days" in body) {
    const n = Number(body.default_terms_days);
    if (!isFinite(n) || n < 0 || n > 365) return NextResponse.json({ error: "Default terms must be 0–365 days." }, { status: 400 });
    patch.default_terms_days = Math.round(n);
  }
  if ("default_note" in body) patch.default_note = cleanText(body.default_note, 2000);
  if (Object.keys(patch).length) {
    patch.updated_at = now;
    const { data, error } = await admin.from("billing_staff").update(patch).eq("profile_id", params.id).select("profile_id").maybeSingle();
    if (error) return dbError(error);
    if (!data) return NextResponse.json({ error: "Login not found." }, { status: 404 });
  }

  const list = Array.isArray(body.brands) ? body.brands : [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (!b || !isBrandKey(b.brand)) return NextResponse.json({ error: "Unknown brand." }, { status: 400 });
    const reply = cleanText(b.reply_to_email, 254);
    if (!isEmail(reply)) return NextResponse.json({ error: "That reply-to email doesn't look right." }, { status: 400 });
    const row: Record<string, unknown> = { from_name: cleanText(b.from_name, 120), reply_to_email: reply ? reply.toLowerCase() : null, phone: cleanText(b.phone, 40), updated_at: now };
    // Phase 2 fields (migration 20261107).
    if ("invoice_prefix" in b) {
      const pre = cleanText(b.invoice_prefix, 8);
      if (pre && !/^[A-Za-z0-9-]+$/.test(pre)) return NextResponse.json({ error: "Prefix: letters, numbers or dashes, up to 8." }, { status: 400 });
      row.invoice_prefix = pre ? pre.toUpperCase() : null;
    }
    if ("address" in b) row.address = cleanText(b.address, 500);
    if ("payment_instructions" in b) row.payment_instructions = cleanText(b.payment_instructions, 1000);
    const { error } = await admin.from("billing_staff_brands").update(row).eq("profile_id", params.id).eq("brand", b.brand);
    if (error) return dbError(error);
    if (b.next_number != null) {
      const n = Number(b.next_number);
      if (!isFinite(n) || n < 1 || n > 9999999) return NextResponse.json({ error: "Next number must be a positive whole number." }, { status: 400 });
      const { error: cErr } = await admin
        .from("billing_invoice_counters")
        .upsert({ owner_id: params.id, brand: b.brand, next_number: Math.round(n), updated_at: now }, { onConflict: "owner_id,brand" });
      if (cErr) return dbError(cErr);
    }
  }
  return NextResponse.json({ ok: true });
}
