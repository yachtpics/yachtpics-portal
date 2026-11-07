import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingBillingTable, requireBillingStaff } from "@/lib/books/staff";
import { bad, isUuid } from "@/lib/books/api";
import { CONTACT_COLS, MIRRORED, contactFields } from "@/lib/books/contacts";
import { CONTACTS_NOT_READY, type BillingClientContact } from "@/lib/books/types";

export const runtime = "nodejs";

const notReady = () => NextResponse.json({ error: CONTACTS_NOT_READY, notReady: true }, { status: 503 });

type Loaded = { contact: BillingClientContact } | { res: NextResponse };

async function loadContact(admin: SupabaseClient, clientId: string, contactId: string): Promise<Loaded> {
  if (!isUuid(clientId) || !isUuid(contactId)) return { res: bad("Contact not found.", 404) };
  const { data, error } = await admin.from("billing_client_contacts").select(CONTACT_COLS).eq("id", contactId).eq("client_id", clientId).maybeSingle();
  if (error) return { res: isMissingBillingTable(error) ? notReady() : bad(error.message, 500) };
  if (!data) return { res: bad("Contact not found.", 404) };
  return { contact: data as BillingClientContact };
}

/**
 * PATCH — edit a contact. Body: any of first_name, last_name, email, phone,
 * mobile, role, send_by_default, and is_primary: true to make it the primary
 * contact (is_primary: false is refused — make another contact primary
 * instead). Editing the primary contact's email / phone / mobile also
 * updates the client, so everything that reads the client's email stays right.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; contactId: string } }) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("Invalid request body");
  const found = await loadContact(admin, params.id, params.contactId);
  if ("res" in found) return found.res;
  const cur = found.contact;

  if (body.is_primary === false && cur.is_primary) return bad("Make another contact primary instead.");
  const makePrimary = body.is_primary === true && !cur.is_primary;
  const { fields, error } = contactFields(body);
  if (error) return bad(error);
  if (!makePrimary && !Object.keys(fields).length) return bad("Nothing to change.");

  const next = { ...cur, ...fields } as BillingClientContact;
  if (!next.email && !next.first_name && !next.last_name) return bad("Give the contact a name or an email.");
  if ((cur.is_primary || makePrimary) && !next.email) return bad("The primary contact needs an email.");
  if (fields.email && fields.email !== (cur.email ?? "").toLowerCase()) {
    const { data: others } = await admin.from("billing_client_contacts").select("id, email").eq("client_id", params.id).neq("id", cur.id);
    if (((others ?? []) as { email: string | null }[]).some((o) => (o.email ?? "").toLowerCase() === fields.email)) {
      return bad("That email is already a contact for this client.");
    }
  }

  const now = new Date().toISOString();
  if (Object.keys(fields).length) {
    const { error: upErr } = await admin.from("billing_client_contacts").update({ ...fields, updated_at: now }).eq("id", cur.id);
    if (upErr) return bad(upErr.message, 500);
  }

  if (makePrimary) {
    const { error: pErr } = await admin.rpc("billing_set_primary_contact", { p_contact: cur.id, actor: staff.profileId });
    if (pErr) return bad("Saved, but it couldn't be made primary: " + pErr.message, 500);
    await admin.rpc("billing_relink_brokers", { only_client: params.id });
  } else if (cur.is_primary) {
    const mirror: Record<string, unknown> = {};
    MIRRORED.forEach((k) => { if (k in fields) mirror[k] = fields[k]; });
    if (Object.keys(mirror).length) {
      const { error: clErr } = await admin
        .from("billing_clients")
        .update({ ...mirror, updated_at: now, updated_by: staff.profileId, local_edited_at: now })
        .eq("id", params.id);
      if (clErr) return bad("Contact saved, but the client's details couldn't be updated: " + clErr.message, 500);
      if ("email" in mirror) await admin.rpc("billing_relink_brokers", { only_client: params.id });
    }
  }
  return NextResponse.json({ ok: true });
}

/** DELETE — remove a contact. The primary contact can't be removed (make another one primary first). */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; contactId: string } }) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin } = auth;
  const found = await loadContact(admin, params.id, params.contactId);
  if ("res" in found) return found.res;
  if (found.contact.is_primary) return bad("The primary contact can't be removed — make another contact primary first.");
  const { error } = await admin.from("billing_client_contacts").delete().eq("id", found.contact.id).eq("is_primary", false);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
