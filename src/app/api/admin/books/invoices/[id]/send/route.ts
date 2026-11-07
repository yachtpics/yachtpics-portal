import { NextRequest, NextResponse } from "next/server";
import { isEmail, requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError } from "@/lib/books/api";
import { loadInvoice, recalcInvoice } from "@/lib/books/invoices";
import { buildInvoicePdf } from "@/lib/books/invoicePdf";
import { sendInvoiceEmail } from "@/lib/books/invoiceEmail";
import { invoiceLabel, todayET } from "@/lib/books/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST — send (or re-send) an invoice. Body: { to?: string, email?: boolean }.
 * The number is assigned the first time (billing_next_invoice_number, row
 * lock) and kept for every re-send. email:false = "mark as sent" without
 * emailing (handed over in person). If the email fails the invoice keeps its
 * new number but stays as it was, so Send can simply be tried again.
 *
 * Dates: sent_at is stamped on the first send and kept. Due on receipt — at
 * the first send, unless the due date was set by hand (due_date_manual), the
 * due date becomes the sent date (ET).
 *
 * Test invoices (is_test) never take a number from the counter, and may only
 * be emailed to a billing staff address or an @yachtpics.com address.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const first = await loadInvoice(admin, staff, params.id);
  if ("notReady" in first) return dbError({ code: "42P01" });
  if ("notFound" in first) return bad("Invoice not found.", 404);
  if ("error" in first) return bad(first.error, 500);
  let inv = first.bundle.invoice;
  if (inv.status === "void") return bad("This invoice is void.");
  if (!first.bundle.lines.length) return bad("Add at least one line first.");
  if (!inv.client_id) return bad("Pick who the invoice is for first.");

  const body = ((await req.json().catch(() => null)) ?? {}) as { to?: string; email?: boolean };
  const emailIt = body.email !== false;
  const to = (typeof body.to === "string" ? body.to : first.bundle.client?.email ?? "").trim().toLowerCase();
  if (emailIt && (!to || !isEmail(to))) return bad("Enter the email address to send it to.");
  if (emailIt && inv.is_test && !(await isStaffAddress(admin, to))) {
    return bad("A test invoice can only be emailed to a billing staff address or an @yachtpics.com address.");
  }

  if (!inv.number && !inv.is_test) {
    const { data: number, error } = await admin.rpc("billing_next_invoice_number", { p_owner: staff.profileId, p_brand: inv.brand });
    if (error) return dbError(error);
    const { error: upErr } = await admin.from("billing_invoices").update({ number }).eq("id", inv.id).is("number", null);
    if (upErr) return dbError(upErr);
  }
  const rc = await recalcInvoice(admin, inv.id);
  if (rc) return bad(rc, 500);

  const again = await loadInvoice(admin, staff, params.id);
  if (!("bundle" in again)) return bad("Invoice couldn't be reloaded.", 500);
  inv = again.bundle.invoice;

  // What this send stamps: the sent date (first send only) and, due on
  // receipt, the due date = the sent date unless it was set by hand. Put on
  // the bundle first so the emailed PDF already shows them.
  const now = new Date().toISOString();
  const firstSend = !inv.sent_at;
  const dueToday = firstSend && !inv.due_date_manual && !inv.terms_days;
  const sentAt = inv.sent_at ?? now;
  again.bundle.invoice = { ...inv, sent_at: sentAt, due_date: dueToday ? todayET() : inv.due_date, status: inv.status === "draft" ? "sent" : inv.status };

  if (emailIt) {
    let pdf: Uint8Array;
    try {
      pdf = await buildInvoicePdf(again.bundle);
    } catch (e) {
      return bad("The PDF couldn't be made: " + (e instanceof Error ? e.message : String(e)), 500);
    }
    const { error } = await sendInvoiceEmail(again.bundle, pdf, to, staff.profileId);
    if (error) return bad(`The email didn't go: ${error}. ${inv.is_test ? "The test invoice" : `Invoice ${inv.number}`} is saved — try Send again.`, 502);
  }

  const patch: Record<string, unknown> = {
    status: inv.status === "draft" ? "sent" : inv.status,
    sent_at: sentAt,
    sent_to: emailIt ? to : inv.sent_to,
    updated_by: staff.profileId,
    updated_at: now,
  };
  if (dueToday) patch.due_date = todayET();
  const { error: stErr } = await admin.from("billing_invoices").update(patch).eq("id", inv.id);
  if (stErr) return dbError(stErr);
  await recalcInvoice(admin, inv.id);
  return NextResponse.json({ ok: true, number: invoiceLabel(inv), emailed: emailIt ? to : null });
}

/** A billing staff login's address (profile email or a reply-to) or anything @yachtpics.com. */
async function isStaffAddress(admin: SupabaseClient, to: string): Promise<boolean> {
  if (/@yachtpics\.com$/i.test(to)) return true;
  const { data: staffRows } = await admin.from("billing_staff").select("profile_id").eq("active", true);
  const ids = ((staffRows ?? []) as { profile_id: string }[]).map((r) => r.profile_id);
  if (!ids.length) return false;
  const [{ data: profiles }, { data: brands }] = await Promise.all([
    admin.from("profiles").select("display_email").in("id", ids),
    admin.from("billing_staff_brands").select("reply_to_email").in("profile_id", ids),
  ]);
  const known: string[] = [];
  ((profiles ?? []) as { display_email: string | null }[]).forEach((p) => { if (p.display_email) known.push(p.display_email.trim().toLowerCase()); });
  ((brands ?? []) as { reply_to_email: string | null }[]).forEach((b) => { if (b.reply_to_email) known.push(b.reply_to_email.trim().toLowerCase()); });
  for (let i = 0; i < ids.length; i++) {
    try {
      const { data } = await admin.auth.admin.getUserById(ids[i]);
      if (data?.user?.email) known.push(data.user.email.trim().toLowerCase());
    } catch {
      /* fall back to the profile / reply-to addresses */
    }
  }
  return known.indexOf(to) !== -1;
}
