/**
 * Edit a sent invoice with a reason (20261109b) — server helpers.
 *
 * A save in the editor is two calls (header PATCH, then lines PUT). The
 * browser makes one edit_id (uuid) per save and sends it with edit_reason on
 * both. Each call, before changing anything, probes billing_invoice_edits
 * (missing table → 503 EDITS_NOT_READY, nothing changed). After its change
 * and recalc it upserts the row by id: the first call inserts it with
 * total_before = the total before that call; a later call with the same id
 * keeps total_before, sets total_after and appends to changes. So one save =
 * one row, total_before = before the save, total_after = after both calls.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { isMissingBillingTable, type BillingStaff } from "./staff";
import { isUuid } from "./api";
import { EDIT_REASON_MAX, EDIT_REASON_MIN, fmtDate, type BillingInvoice, type InvoiceEdit, type InvoiceLine } from "./types";

export type EditEnvelope = { reason: string; editId: string };

/**
 * The reason + edit id from a request body. null: no usable reason (the
 * caller answers the usual 409 LOCKED_MESSAGE). error: a reason over the limit.
 */
export function editEnvelopeOf(body: Record<string, unknown> | null | undefined): EditEnvelope | null | { error: string } {
  const raw = body && typeof body.edit_reason === "string" ? body.edit_reason.replace(/\s+/g, " ").trim() : "";
  if (raw.length < EDIT_REASON_MIN) return null;
  if (raw.length > EDIT_REASON_MAX) return { error: `Keep the reason under ${EDIT_REASON_MAX} characters.` };
  return { reason: raw, editId: isUuid(body?.edit_id) ? (body?.edit_id as string) : randomUUID() };
}

type EditRow = { id: string; invoice_id: string; changes: string | null };

/** Is the history table there, and is this edit id already in use? */
export async function probeEdit(admin: SupabaseClient, editId: string, invoiceId: string): Promise<{ ready: false } | { ready: true; existing: EditRow | null } | { error: string }> {
  const { data, error } = await admin.from("billing_invoice_edits").select("id, invoice_id, changes").eq("id", editId).maybeSingle();
  if (error) return isMissingBillingTable(error) ? { ready: false } : { error: error.message };
  const row = (data as EditRow | null) ?? null;
  if (row && row.invoice_id !== invoiceId) return { error: "That edit belongs to another invoice — reload and try again." };
  return { ready: true, existing: row };
}

const joinChanges = (a: string | null, b: string | null) => [a, b].filter((x) => !!x && x.trim()).join("; ") || null;

/**
 * Write (or extend) the history row for this save. `before` is the invoice
 * as it was before THIS call. Best-effort after the change is made: returns
 * an error message (logged by the caller), never throws.
 */
export async function recordEdit(
  admin: SupabaseClient,
  p: { env: EditEnvelope; existing: EditRow | null; before: BillingInvoice; staff: BillingStaff; change: string | null }
): Promise<string | null> {
  const { data: after } = await admin.from("billing_invoices").select("total").eq("id", p.before.id).maybeSingle();
  const totalAfter = after ? Number((after as { total: unknown }).total) : null;
  const update = async (prev: string | null) => {
    const { error } = await admin.from("billing_invoice_edits")
      .update({ total_after: totalAfter, changes: joinChanges(prev, p.change), edited_at: new Date().toISOString() })
      .eq("id", p.env.editId).eq("invoice_id", p.before.id);
    return error ? error.message : null;
  };
  if (p.existing) return update(p.existing.changes);
  const { error } = await admin.from("billing_invoice_edits").insert({
    id: p.env.editId,
    invoice_id: p.before.id,
    owner_id: p.before.owner_id,
    edited_by: p.staff.profileId,
    edited_by_name: p.staff.displayName,
    reason: p.env.reason,
    total_before: p.before.total,
    total_after: totalAfter,
    changes: p.change,
  });
  if (!error) return null;
  if (error.code === "23505") {
    // The other call of the same save got there first: extend its row.
    const again = await probeEdit(admin, p.env.editId, p.before.id);
    if ("ready" in again && again.ready) return update(again.existing?.changes ?? null);
  }
  return error.message;
}

/** The invoice's edit history, newest first. Missing table (before 20261109b) → []. */
export async function loadInvoiceEdits(admin: SupabaseClient, invoiceId: string): Promise<InvoiceEdit[]> {
  const { data, error } = await admin.from("billing_invoice_edits").select("*").eq("invoice_id", invoiceId).order("edited_at", { ascending: false }).range(0, 199);
  if (error) {
    if (!isMissingBillingTable(error)) console.warn(`[billing-edits] history for ${invoiceId} unreadable: ${error.message}`);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as InvoiceEdit),
    total_before: r.total_before == null ? null : Number(r.total_before),
    total_after: r.total_after == null ? null : Number(r.total_after),
  }));
}

const shortDate = (d: unknown) => (typeof d === "string" && d ? fmtDate(d).replace(/, \d{4}$/, "") : "none");

/** A short summary of the header fields a PATCH actually changes ("due date Nov 9 → Nov 20; client changed"). */
export function headerChangeSummary(fields: Record<string, unknown>, inv: BillingInvoice): string | null {
  const out: string[] = [];
  const diff = (k: keyof BillingInvoice) => k in fields && (fields[k as string] ?? null) !== (inv[k] ?? null);
  if (diff("client_id")) out.push("client changed");
  if (diff("listing_id") || diff("boat_name") || diff("boat_make") || diff("boat_model") || diff("boat_year") || ("boat_length_ft" in fields && Number(fields.boat_length_ft ?? -1) !== Number(inv.boat_length_ft ?? -1))) out.push("boat changed");
  if (diff("issue_date")) out.push(`invoice date ${shortDate(inv.issue_date)} → ${shortDate(fields.issue_date)}`);
  if (diff("due_date")) out.push(`due date ${shortDate(inv.due_date)} → ${shortDate(fields.due_date)}`);
  if (diff("note")) out.push("note changed");
  if (diff("internal_note")) out.push("internal note changed");
  if ("reminders_paused" in fields && fields.reminders_paused !== !!inv.reminders_paused) out.push(fields.reminders_paused ? "reminders paused" : "reminders back on");
  if ("online_pay" in fields && fields.online_pay !== (inv.online_pay !== false)) out.push(fields.online_pay ? "Pay online on" : "Pay online off");
  return out.length ? out.join("; ") : null;
}

// The card-fee line's name and amount are set by the server, so only its presence counts.
const lineKey = (l: InvoiceLine) => l.kind === "card_fee" ? "card_fee" : JSON.stringify([l.kind, l.item_id ?? null, l.name, l.description ?? null, Number(l.quantity), l.unit, Number(l.unit_price), l.discount_type ?? null, l.discount_value == null ? null : Number(l.discount_value), !!l.taxable]);

/** "Lines changed" when the new list differs from the saved one (order counts). */
export function linesChangeSummary(before: InvoiceLine[], after: InvoiceLine[]): string | null {
  if (before.length !== after.length) return "Lines changed";
  for (let i = 0; i < before.length; i++) if (lineKey(before[i]) !== lineKey(after[i])) return "Lines changed";
  return null;
}
