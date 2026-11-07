import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";

export const runtime = "nodejs";

type C = Record<string, unknown> & { id: string; zoho_contact_id: string | null; zoho_merged_ids: string[] | null };

const FILL = ["company_name", "first_name", "last_name", "email", "phone", "mobile", "broker_profile_id", "zoho_created_on"];

/**
 * Merge possible duplicates into one survivor (owner only). Empty fields on
 * the survivor are filled from the others, notes are joined, Zoho ids are
 * kept in zoho_merged_ids (so a re-pull never brings them back) and the Zoho
 * balances are added. The others are then deleted.
 *
 * Safe in phase 1 because nothing points at a client yet. PHASE 2: move the
 * others' invoices/payments to the survivor before the delete.
 */
export async function POST(req: NextRequest) {
  const auth = await requireBillingStaff({ ownerOnly: true });
  if (auth.error) return auth.error;
  const { admin, staff } = auth;

  const body = (await req.json().catch(() => null)) as { survivorId?: string; otherIds?: string[] } | null;
  const survivorId = body?.survivorId;
  const otherIds = Array.isArray(body?.otherIds) ? body!.otherIds!.filter((x) => typeof x === "string" && x !== survivorId) : [];
  if (!survivorId || !otherIds.length) return NextResponse.json({ error: "Pick the client to keep and at least one to merge in." }, { status: 400 });

  const { data, error } = await admin.from("billing_clients").select("*").in("id", [survivorId].concat(otherIds));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as C[];
  const keep = rows.filter((r) => r.id === survivorId)[0];
  const others = rows.filter((r) => r.id !== survivorId);
  if (!keep || others.length !== otherIds.length) return NextResponse.json({ error: "One of those clients no longer exists — refresh the page." }, { status: 404 });

  const patch: Record<string, unknown> = {};
  FILL.forEach((f) => {
    if (keep[f]) return;
    const donor = others.filter((o) => !!o[f])[0];
    if (donor) patch[f] = donor[f];
  });
  const notes = [keep.notes].concat(others.map((o) => o.notes)).filter((n) => typeof n === "string" && n.trim()) as string[];
  if (notes.length > 1 || (notes.length === 1 && !keep.notes)) patch.notes = notes.join("\n\n");

  const ids: string[] = (keep.zoho_merged_ids ?? []).slice();
  others.forEach((o) => {
    [o.zoho_contact_id].concat(o.zoho_merged_ids ?? []).forEach((z) => {
      if (z && z !== keep.zoho_contact_id && ids.indexOf(z) === -1) ids.push(z);
    });
  });
  patch.zoho_merged_ids = ids;

  const balances = [keep].concat(others).map((r) => (r.zoho_open_balance == null ? null : Number(r.zoho_open_balance)));
  if (balances.some((b) => b != null)) {
    patch.zoho_open_balance = Math.round(balances.reduce((s: number, b) => s + (b ?? 0), 0) * 100) / 100;
  }
  if (keep.status !== "active" && others.some((o) => o.status === "active")) patch.status = "active";

  const now = new Date().toISOString();
  patch.updated_at = now;
  patch.updated_by = staff.profileId;
  patch.local_edited_at = now;

  // Update the survivor first, then delete the others: if the delete fails,
  // nothing is lost (the duplicates simply still show on the panel).
  const { error: upErr } = await admin.from("billing_clients").update(patch).eq("id", survivorId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  // Contacts (20261108c): the others' contacts move to the survivor as
  // non-primary ones, unless the survivor already has that email. Skipped
  // quietly if the contacts table isn't there yet.
  const { data: all, error: kErr } = await admin.from("billing_client_contacts").select("id, client_id, email").in("client_id", [survivorId].concat(otherIds));
  if (!kErr) {
    const list = (all ?? []) as { id: string; client_id: string; email: string | null }[];
    const have: string[] = list.filter((x) => x.client_id === survivorId && x.email).map((x) => (x.email as string).toLowerCase());
    const move: string[] = [];
    list.forEach((x) => {
      if (x.client_id === survivorId) return;
      const e = (x.email ?? "").toLowerCase();
      if (e && have.indexOf(e) !== -1) return;
      if (e) have.push(e);
      move.push(x.id);
    });
    if (move.length) {
      const { error: mvErr } = await admin.from("billing_client_contacts").update({ client_id: survivorId, is_primary: false, updated_at: now }).in("id", move);
      if (mvErr) return NextResponse.json({ error: "Kept client updated, but the others' contacts couldn't be moved: " + mvErr.message }, { status: 500 });
    }
  }

  const { error: delErr } = await admin.from("billing_clients").delete().in("id", otherIds);
  if (delErr) return NextResponse.json({ error: "Kept client updated, but the others couldn't be removed: " + delErr.message }, { status: 500 });

  await admin.rpc("billing_relink_brokers", { only_client: survivorId });
  return NextResponse.json({ ok: true, merged: others.length });
}
