/**
 * Billing — contact persons per client (migration 20261108c). Server helpers
 * shared by the contacts API, the Send route, reminders and receipts.
 *
 * The primary contact mirrors billing_clients.email / phone / mobile: the
 * database copies client edits onto it (trigger), and the contacts API copies
 * primary-contact edits back onto the client, so everything that still reads
 * the client's email keeps working.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanText, isEmail } from "./staff";
import type { BillingClientContact } from "./types";

export const CONTACT_COLS =
  "id, client_id, first_name, last_name, email, phone, mobile, role, is_primary, send_by_default, zoho_contact_person_id, created_at, updated_at";

export function sortContacts(list: BillingClientContact[]): BillingClientContact[] {
  return list.slice().sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return String(a.created_at ?? "") < String(b.created_at ?? "") ? -1 : 1;
  });
}

/** A client's contacts, primary first. Empty when the table isn't there yet (or on any error). */
export async function loadClientContacts(admin: SupabaseClient, clientId: string | null | undefined): Promise<BillingClientContact[]> {
  if (!clientId) return [];
  try {
    const { data, error } = await admin.from("billing_client_contacts").select(CONTACT_COLS).eq("client_id", clientId);
    if (error) return [];
    return sortContacts((data ?? []) as BillingClientContact[]);
  } catch {
    return [];
  }
}

/**
 * Validated contact fields from a create/edit body. Only keys present in the
 * body are returned. is_primary is NOT taken here (it goes through
 * billing_set_primary_contact).
 */
export function contactFields(body: Record<string, unknown>): { fields: Record<string, unknown>; error?: string } {
  const fields: Record<string, unknown> = {};
  ["first_name", "last_name", "phone", "mobile"].forEach((k) => { if (k in body) fields[k] = cleanText(body[k], 200); });
  if ("role" in body) fields.role = cleanText(body.role, 100);
  if ("email" in body) {
    const e = cleanText(body.email, 254);
    const email = e ? e.toLowerCase() : null;
    if (!isEmail(email)) return { fields, error: "That email doesn't look right." };
    fields.email = email;
  }
  if ("send_by_default" in body) {
    if (typeof body.send_by_default !== "boolean") return { fields, error: "Gets invoices must be on or off." };
    fields.send_by_default = body.send_by_default;
  }
  return { fields };
}

/** The fields of a primary contact that are copied onto the client row. */
export const MIRRORED = ["email", "phone", "mobile"];
