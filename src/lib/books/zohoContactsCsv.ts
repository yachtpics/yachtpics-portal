/**
 * Zoho "contact persons" CSV → billing_client_contacts (migration 20261108c).
 * Owner-only Settings upload, POST /api/admin/books/clients/import-contacts.
 *
 * Columns: zoho_contact_id, contact_person_id, is_primary_contact,
 * first_name, last_name, email, phone, mobile, designation, department.
 *
 * For each row: the client is found by zoho_contact_id (or one of its
 * zoho_merged_ids). The contact is matched, in this order, by
 * zoho_contact_person_id; else the same client + same email on a contact not
 * yet tied to Zoho; else (primary rows) the client's primary contact not yet
 * tied to Zoho (the one the migration backfilled from the client row). A
 * match is updated (a blank CSV value never blanks a field; "Gets invoices"
 * is left as it is, so a re-import keeps Charlie's ticks); otherwise a new
 * contact is added — primary rows get "Gets invoices" on, others OFF (Charlie
 * ticks the ones who should get invoices). role = designation, else
 * department. Rows with no email that aren't primary are skipped.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normKey } from "./zohoCsv";

type Row = Record<string, string>;

export const CONTACT_PERSON_HEADERS = ["zoho_contact_id", "contact_person_id", "email"];

export type ContactImportResult = {
  rows: number;
  clientsMatched: number;
  added: number;
  updated: number;
  unchanged: number;
  madePrimary: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  /** A few examples of skipped rows (Zoho ids), for checking. */
  skippedExamples: string[];
};

type Contact = {
  id: string;
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  role: string | null;
  is_primary: boolean;
  send_by_default: boolean;
  zoho_contact_person_id: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const yes = (v: string) => { const k = normKey(v); return k === "true" || k === "yes" || k === "1" || k === "y"; };
const val = (v: string | undefined, max = 200) => { const t = (v ?? "").trim(); return t ? t.slice(0, max) : null; };

async function readAll<T>(admin: SupabaseClient, table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await admin.from(table).select(cols).range(from, from + 999);
    if (error) throw Object.assign(new Error(`${table}: ${error.message}`), { code: error.code });
    const rows = (data ?? []) as unknown as T[];
    rows.forEach((r) => out.push(r));
    if (rows.length < 1000) break;
  }
  return out;
}

export async function importZohoContactPersons(admin: SupabaseClient, rows: Row[]): Promise<ContactImportResult> {
  const res: ContactImportResult = { rows: rows.length, clientsMatched: 0, added: 0, updated: 0, unchanged: 0, madePrimary: 0, skipped: 0, skippedReasons: {}, skippedExamples: [] };
  const skip = (reason: string, example: string) => {
    res.skipped++;
    res.skippedReasons[reason] = (res.skippedReasons[reason] || 0) + 1;
    if (res.skippedExamples.length < 15) res.skippedExamples.push(`${example}: ${reason}`);
  };

  const clients = await readAll<{ id: string; zoho_contact_id: string | null; zoho_merged_ids: string[] | null }>(admin, "billing_clients", "id, zoho_contact_id, zoho_merged_ids");
  const clientByZoho: Record<string, string> = {};
  clients.forEach((c) => { if (c.zoho_contact_id) clientByZoho[c.zoho_contact_id] = c.id; });
  clients.forEach((c) => (c.zoho_merged_ids ?? []).forEach((z) => { if (z && !clientByZoho[z]) clientByZoho[z] = c.id; }));

  const contacts = await readAll<Contact>(admin, "billing_client_contacts", "id, client_id, first_name, last_name, email, phone, mobile, role, is_primary, send_by_default, zoho_contact_person_id");
  const byPid: Record<string, Contact> = {};
  const byClient: Record<string, Contact[]> = {};
  contacts.forEach((k) => {
    if (k.zoho_contact_person_id) byPid[k.zoho_contact_person_id] = k;
    (byClient[k.client_id] = byClient[k.client_id] || []).push(k);
  });

  const matchedClients: Record<string, true> = {};
  const seenPid: Record<string, true> = {};
  const updates: Contact[] = [];
  const inserts: (Omit<Contact, "id">)[] = [];
  const toPrimaryPids: string[] = []; // contacts (by Zoho person id) to make primary after the writes
  const now = new Date().toISOString();

  rows.forEach((r, idx) => {
    const pid = (r.contact_person_id || "").trim();
    const zid = (r.zoho_contact_id || "").trim();
    const label = pid || zid || `row ${idx + 2}`;
    if (!pid) { skip("no contact_person_id", label); return; }
    if (seenPid[pid]) { skip("same contact_person_id twice in the file", label); return; }
    seenPid[pid] = true;
    const primary = yes(r.is_primary_contact || "");
    const emailRaw = (r.email || "").trim().toLowerCase();
    const email = emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw : null;
    if (emailRaw && !email) { skip("email doesn't look right", label); return; }
    if (!email && !primary) { skip("no email (and not the primary contact)", label); return; }
    const clientId = zid ? clientByZoho[zid] : undefined;
    if (!clientId) { skip(zid ? "no client with that Zoho contact id" : "no zoho_contact_id", label); return; }
    matchedClients[clientId] = true;

    const list = byClient[clientId] || (byClient[clientId] = []);
    let hit: Contact | undefined = byPid[pid];
    if (hit && hit.client_id !== clientId) { skip("that contact person is already on another client", label); return; }
    if (!hit && email) hit = list.filter((k) => !k.zoho_contact_person_id && (k.email ?? "").toLowerCase() === email)[0];
    if (!hit && primary) hit = list.filter((k) => !k.zoho_contact_person_id && k.is_primary)[0];

    const incoming = {
      first_name: val(r.first_name),
      last_name: val(r.last_name),
      email,
      phone: val(r.phone),
      mobile: val(r.mobile),
      role: val(r.designation, 100) || val(r.department, 100),
    };

    if (hit) {
      const next: Contact = { ...hit, zoho_contact_person_id: pid };
      (Object.keys(incoming) as (keyof typeof incoming)[]).forEach((k) => { if (incoming[k]) next[k] = incoming[k] as string; });
      const changed = (Object.keys(next) as (keyof Contact)[]).some((k) => next[k] !== hit![k]);
      if (changed) { updates.push(next); res.updated++; } else res.unchanged++;
      // Keep the in-memory copy current for later rows of the same client.
      list[list.indexOf(hit)] = next;
      byPid[pid] = next;
      if (primary && !hit.is_primary) toPrimaryPids.push(pid);
      return;
    }

    // New contact. Primary straight away only if the client has no primary yet.
    const hasPrimary = list.some((k) => k.is_primary);
    const row: Omit<Contact, "id"> = {
      client_id: clientId,
      ...incoming,
      is_primary: primary && !hasPrimary,
      send_by_default: primary,
      zoho_contact_person_id: pid,
    };
    inserts.push(row);
    const placeholder = { ...row, id: "" } as Contact;
    list.push(placeholder);
    byPid[pid] = placeholder;
    res.added++;
    if (primary && hasPrimary) toPrimaryPids.push(pid);
  });
  res.clientsMatched = Object.keys(matchedClients).length;

  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200).map((u) => ({ ...u, updated_at: now }));
    const { error } = await admin.from("billing_client_contacts").upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`Updating contacts: ${error.message}`);
  }
  for (let i = 0; i < inserts.length; i += 200) {
    const chunk = inserts.slice(i, i + 200).map((u) => ({ ...u, created_at: now, updated_at: now }));
    const { error } = await admin.from("billing_client_contacts").insert(chunk);
    if (error) throw new Error(`Adding contacts: ${error.message}`);
  }

  // Zoho's primary contact becomes the primary here too (mirrored onto the
  // client's email / phone). Only when it has an email — a primary without
  // one would blank the client's email.
  for (let i = 0; i < toPrimaryPids.length; i++) {
    const { data } = await admin.from("billing_client_contacts").select("id, email").eq("zoho_contact_person_id", toPrimaryPids[i]).maybeSingle();
    const k = data as { id: string; email: string | null } | null;
    if (!k || !k.email) continue;
    const { error } = await admin.rpc("billing_set_primary_contact", { p_contact: k.id, actor: null });
    if (!error) res.madePrimary++;
  }
  if (res.madePrimary) await admin.rpc("billing_relink_brokers", { only_client: null });
  return res;
}
