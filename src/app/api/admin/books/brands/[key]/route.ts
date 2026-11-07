import { NextRequest, NextResponse } from "next/server";
import { cleanText, isBrandKey, requireBillingStaff } from "@/lib/books/staff";
import { isMissingColumn } from "@/lib/books/invoices";

export const runtime = "nodejs";

// Edit a brand's invoice identity (owner only).
export async function PATCH(req: NextRequest, { params }: { params: { key: string } }) {
  const auth = await requireBillingStaff({ ownerOnly: true });
  if (auth.error) return auth.error;
  const { admin } = auth;
  if (!isBrandKey(params.key)) return NextResponse.json({ error: "Unknown brand." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  // footer_note = the invoice's "Notes"; terms_text = its "Terms & Conditions" (20261107b).
  ["legal_name", "logo_url", "address", "phone", "email", "website", "footer_note", "terms_text"].forEach((k) => {
    if (k in body) patch[k] = cleanText(body[k], k === "terms_text" ? 4000 : k === "footer_note" || k === "address" ? 1000 : 300);
  });
  if ("display_name" in body) {
    const v = cleanText(body.display_name, 100);
    if (!v) return NextResponse.json({ error: "The brand needs a name." }, { status: 400 });
    patch.display_name = v;
  }
  if ("legal_name" in patch && !patch.legal_name) return NextResponse.json({ error: "The legal name can't be blank." }, { status: 400 });
  if ("invoice_prefix" in body) {
    const v = cleanText(body.invoice_prefix, 8);
    if (!v || !/^[A-Za-z0-9-]+$/.test(v)) return NextResponse.json({ error: "Prefix: letters, numbers or dashes, up to 8." }, { status: 400 });
    patch.invoice_prefix = v.toUpperCase();
  }
  if ("accent_color" in body) {
    const v = cleanText(body.accent_color, 7);
    if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) return NextResponse.json({ error: "Accent colour must look like #c39e4e." }, { status: 400 });
    patch.accent_color = v;
  }
  if (typeof patch.logo_url === "string" && !/^(https:\/\/|\/)/.test(patch.logo_url)) {
    return NextResponse.json({ error: "Logo must be an https:// link or a /path on the Portal." }, { status: 400 });
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  patch.updated_at = new Date().toISOString();

  let { error } = await admin.from("billing_brands").update(patch).eq("key", params.key);
  if (error && "terms_text" in patch && isMissingColumn(error)) {
    // 20261107b not applied yet: save the rest, say the terms didn't keep.
    delete patch.terms_text;
    ({ error } = await admin.from("billing_brands").update(patch).eq("key", params.key));
    if (!error) return NextResponse.json({ error: "Saved, except Terms & Conditions — that switches on with the 20261107b billing migration." }, { status: 503 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
