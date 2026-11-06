import { NextRequest, NextResponse } from "next/server";
import { isBrandKey, requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError } from "@/lib/books/api";
import { loadInvoice, recalcInvoice } from "@/lib/books/invoices";
import { headerFields } from "@/lib/books/invoiceInput";
import type { BrandKey } from "@/lib/books/types";

export const runtime = "nodejs";

type Ctx = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const r = await loadInvoice(auth.admin, auth.staff, params.id);
  if ("notReady" in r) return dbError({ code: "42P01" });
  if ("notFound" in r) return bad("Invoice not found.", 404);
  if ("error" in r) return bad(r.error, 500);
  return NextResponse.json(r.bundle);
}

// PATCH — header fields. Brand only while a draft with no number.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const r = await loadInvoice(admin, staff, params.id);
  if ("notReady" in r) return dbError({ code: "42P01" });
  if ("notFound" in r) return bad("Invoice not found.", 404);
  if ("error" in r) return bad(r.error, 500);
  const inv = r.bundle.invoice;
  if (inv.status === "void") return bad("This invoice is void.");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("Invalid request body");
  const { fields, error } = headerFields(body, inv);
  if (error) return bad(error);

  if ("brand" in body && body.brand !== inv.brand) {
    if (inv.status !== "draft" || inv.number) return bad("The brand can't change after the invoice is sent.");
    if (!isBrandKey(body.brand) || staff.brands.indexOf(body.brand as BrandKey) === -1) return bad("You don't bill under that brand.", 403);
    fields.brand = body.brand;
  }
  if (fields.client_id) {
    const { data: c } = await admin.from("billing_clients").select("id").eq("id", fields.client_id as string).maybeSingle();
    if (!c) return bad("That client no longer exists.");
  }
  if (!Object.keys(fields).length) return NextResponse.json({ ok: true });

  const { error: upErr } = await admin
    .from("billing_invoices")
    .update({ ...fields, updated_by: staff.profileId, updated_at: new Date().toISOString() })
    .eq("id", inv.id)
    .eq("owner_id", staff.profileId);
  if (upErr) return dbError(upErr);
  const rc = await recalcInvoice(admin, inv.id);
  if (rc) return bad(rc, 500);
  return NextResponse.json({ ok: true });
}

// DELETE — drafts that never got a number only (a numbered invoice is voided instead).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const r = await loadInvoice(admin, staff, params.id);
  if ("notReady" in r) return dbError({ code: "42P01" });
  if ("notFound" in r) return bad("Invoice not found.", 404);
  if ("error" in r) return bad(r.error, 500);
  const inv = r.bundle.invoice;
  if (inv.status !== "draft" || inv.number) return bad("Only an unsent draft can be deleted — void this one instead.");
  const { error } = await admin.from("billing_invoices").delete().eq("id", inv.id).eq("owner_id", staff.profileId).eq("status", "draft");
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
