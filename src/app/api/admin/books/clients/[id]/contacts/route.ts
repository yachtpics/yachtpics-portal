import { NextRequest, NextResponse } from "next/server";
import { isMissingBillingTable, requireBillingStaff } from "@/lib/books/staff";
import { bad, isUuid } from "@/lib/books/api";
import { CONTACT_COLS, contactFields, sortContacts } from "@/lib/books/contacts";
import { CONTACTS_NOT_READY, type BillingClientContact } from "@/lib/books/types";

export const runtime = "nodejs";

const notReady = () => NextResponse.json({ error: CONTACTS_NOT_READY, notReady: true }, { status: 503 });

/** GET — a client's contacts (primary first). Billing staff only (the client list is shared). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin } = auth;
  if (!isUuid(params.id)) return bad("Client not found.", 404);

  const { data, error } = await admin.from("billing_client_contacts").select(CONTACT_COLS).eq("client_id", params.id);
  if (error) return isMissingBillingTable(error) ? notReady() : bad(error.message, 500);
  return NextResponse.json({ ok: true, contacts: sortContacts((data ?? []) as BillingClientContact[]) });
}

/**
 * POST — add a contact. Body: first_name, last_name, email, phone, mobile,
 * role, send_by_default, is_primary. Needs a name or an email. The client's
 * first contact is always the primary one; making a contact primary copies
 * its email / phone / mobile onto the client (billing_set_primary_contact).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  if (!isUuid(params.id)) return bad("Client not found.", 404);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("Invalid request body");
  const { fields, error } = contactFields(body);
  if (error) return bad(error);
  if (!fields.email && !fields.first_name && !fields.last_name) return bad("Give the contact a name or an email.");

  const { data: client, error: cErr } = await admin.from("billing_clients").select("id").eq("id", params.id).maybeSingle();
  if (cErr) return bad(cErr.message, 500);
  if (!client) return bad("Client not found.", 404);

  const { data: existing, error: eErr } = await admin.from("billing_client_contacts").select("id, email, is_primary").eq("client_id", params.id);
  if (eErr) return isMissingBillingTable(eErr) ? notReady() : bad(eErr.message, 500);
  const rows = (existing ?? []) as { id: string; email: string | null; is_primary: boolean }[];
  if (fields.email && rows.some((r) => (r.email ?? "").toLowerCase() === fields.email)) return bad("That email is already a contact for this client.");

  const makePrimary = body.is_primary === true || !rows.some((r) => r.is_primary);
  if (makePrimary && !fields.email) return bad("The primary contact needs an email.");

  const now = new Date().toISOString();
  const { data: ins, error: insErr } = await admin
    .from("billing_client_contacts")
    .insert({
      ...fields,
      client_id: params.id,
      is_primary: false,
      send_by_default: typeof fields.send_by_default === "boolean" ? fields.send_by_default : makePrimary,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (insErr) return isMissingBillingTable(insErr) ? notReady() : bad(insErr.message, 500);

  if (makePrimary) {
    const { error: pErr } = await admin.rpc("billing_set_primary_contact", { p_contact: ins.id, actor: staff.profileId });
    if (pErr) return bad("Contact added, but it couldn't be made primary: " + pErr.message, 500);
    await admin.rpc("billing_relink_brokers", { only_client: params.id });
  }
  return NextResponse.json({ ok: true, id: ins.id });
}
