import { NextRequest, NextResponse } from "next/server";
import { isEmail, requireBillingStaff } from "@/lib/books/staff";
import { bad, dbError } from "@/lib/books/api";
import { loadInvoice, recalcInvoice, updateInvoiceRow } from "@/lib/books/invoices";
import { loadClientContacts } from "@/lib/books/contacts";
import { buildInvoicePdf } from "@/lib/books/invoicePdf";
import { sendInvoiceEmail } from "@/lib/books/invoiceEmail";
import { MAX_RECIPIENTS, greetingFirstName, invoiceLabel, invoiceRecipients, todayET } from "@/lib/books/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST — send (or re-send) an invoice. Body: { to?: string[] | string,
 * email?: boolean, saveContacts?: string[] }. `to` = every recipient (one
 * email, all in the To line — they see each other); left out = the last
 * send's recipients, else the client's "Gets invoices" contacts, else the
 * client's email. saveContacts = one-off addresses (also in `to`) to keep as
 * contacts of the client after a successful send. sent_to_all keeps every
 * recipient; sent_to keeps the first (older code reads it).
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
 * be emailed to billing staff / @yachtpics.com addresses — EVERY recipient.
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

  const body = ((await req.json().catch(() => null)) ?? {}) as { to?: unknown; email?: boolean; saveContacts?: unknown };
  const emailIt = body.email !== false;
  const contacts = await loadClientContacts(admin, inv.client_id);

  let raw: unknown[];
  if (Array.isArray(body.to)) raw = body.to;
  else if (typeof body.to === "string") raw = body.to.split(/[,;]/);
  else {
    const last = invoiceRecipients(inv);
    const flagged = contacts.filter((c) => c.send_by_default && c.email).map((c) => c.email as string);
    const primary = contacts.filter((c) => c.is_primary && c.email).map((c) => c.email as string);
    raw = last.length ? last : flagged.length ? flagged : primary.length ? primary : [first.bundle.client?.email ?? ""];
  }
  const to: string[] = [];
  for (let i = 0; emailIt && i < raw.length; i++) {
    if (typeof raw[i] !== "string") return bad("Invalid recipient list.");
    const e = (raw[i] as string).trim().toLowerCase();
    if (!e) continue;
    if (!isEmail(e)) return bad(`"${e}" doesn't look like an email address.`);
    if (to.indexOf(e) === -1) to.push(e);
  }
  if (emailIt && !to.length) return bad("Tick at least one person to send it to.");
  if (to.length > MAX_RECIPIENTS) return bad(`An invoice can go to at most ${MAX_RECIPIENTS} addresses.`);
  if (emailIt && inv.is_test) {
    const known = await staffAddresses(admin);
    const outside = to.filter((e) => !/@yachtpics\.com$/i.test(e) && known.indexOf(e) === -1);
    if (outside.length) {
      return bad(`A test invoice can only be emailed to billing staff or @yachtpics.com addresses — not ${outside.join(", ")}.`);
    }
  }
  const saveContacts: string[] = [];
  if (Array.isArray(body.saveContacts)) {
    body.saveContacts.forEach((v) => {
      const e = typeof v === "string" ? v.trim().toLowerCase() : "";
      if (e && to.indexOf(e) !== -1 && saveContacts.indexOf(e) === -1) saveContacts.push(e);
    });
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
    const greet = greetingFirstName(to, again.bundle.client, contacts);
    const { error } = await sendInvoiceEmail(again.bundle, pdf, to, staff.profileId, greet);
    if (error) return bad(`The email didn't go: ${error}. ${inv.is_test ? "The test invoice" : `Invoice ${inv.number}`} is saved — try Send again.`, 502);
  }

  const patch: Record<string, unknown> = {
    status: inv.status === "draft" ? "sent" : inv.status,
    sent_at: sentAt,
    sent_to: emailIt ? to[0] : inv.sent_to,
    updated_by: staff.profileId,
    updated_at: now,
  };
  if (emailIt) patch.sent_to_all = to;
  if (dueToday) patch.due_date = todayET();
  // updateInvoiceRow drops sent_to_all if 20261108c isn't applied yet (sent_to still saves).
  const { error: stErr } = await updateInvoiceRow(admin, inv.id, inv.owner_id, patch);
  if (stErr) return dbError(stErr);
  await recalcInvoice(admin, inv.id);

  // One-off addresses ticked "Save as contact" (only after the email went).
  let saved = 0;
  if (emailIt && saveContacts.length && inv.client_id) {
    const have = contacts.map((c) => (c.email ?? "").toLowerCase());
    const add = saveContacts.filter((e) => have.indexOf(e) === -1);
    if (add.length) {
      const { error: cErr } = await admin.from("billing_client_contacts").insert(
        add.map((e) => ({ client_id: inv.client_id, email: e, is_primary: false, send_by_default: true, created_at: now, updated_at: now }))
      );
      if (!cErr) saved = add.length;
    }
  }
  return NextResponse.json({ ok: true, number: invoiceLabel(inv), emailed: emailIt ? to : null, savedContacts: saved });
}

/** Every billing staff login's address (login email, profile email, per-brand reply-to), lower-cased. */
async function staffAddresses(admin: SupabaseClient): Promise<string[]> {
  const { data: staffRows } = await admin.from("billing_staff").select("profile_id").eq("active", true);
  const ids = ((staffRows ?? []) as { profile_id: string }[]).map((r) => r.profile_id);
  if (!ids.length) return [];
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
  return known;
}
