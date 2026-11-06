/**
 * Billing backups.
 *  - Weekly (job kind `billing_backup`, queued every Sunday by
 *    /api/cron/billing-backup and run by the jobs worker / jobs-tick): every
 *    billing_* table, all books, as one JSON file in the PRIVATE R2 bucket
 *    (R2_VIDEO_BUCKET, never the public media host) at
 *    billing-backups/YYYY-MM-DD.json. The newest 12 are kept.
 *  - On demand (Settings → Download backup, owner only): a zip of CSVs —
 *    the shared tables plus the owner's OWN book (books stay separate).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { r2VideoConfigured, r2VideoDelete, r2VideoListPrefix, r2VideoPut } from "@/lib/r2";
import { toCsv } from "./api";
import { todayET } from "./types";

export const SHARED_TABLES = [
  "billing_brands",
  "billing_staff",
  "billing_staff_brands",
  "billing_clients",
  "billing_client_dupe_dismissals",
  "billing_items",
  "billing_tax_rates",
  "billing_invoice_counters",
];
export const BOOK_TABLES = ["billing_invoices", "billing_invoice_lines", "billing_payments"];
export const BACKUP_PREFIX = "billing-backups/";
const KEEP = 12;

type Select = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

async function readAll(admin: SupabaseClient, table: string, filter?: (q: Select) => Select): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; from < 200000; from += 1000) {
    let q = admin.from(table).select("*");
    if (filter) q = filter(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    (data ?? []).forEach((r) => out.push(r as Record<string, unknown>));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Every billing table, every book. */
export async function dumpAll(admin: SupabaseClient): Promise<Record<string, Record<string, unknown>[]>> {
  const out: Record<string, Record<string, unknown>[]> = {};
  const all = SHARED_TABLES.concat(BOOK_TABLES);
  for (let i = 0; i < all.length; i++) out[all[i]] = await readAll(admin, all[i]);
  return out;
}

/** Shared tables + one login's own invoices, lines and payments. */
export async function dumpForOwner(admin: SupabaseClient, ownerId: string): Promise<Record<string, Record<string, unknown>[]>> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (let i = 0; i < SHARED_TABLES.length; i++) out[SHARED_TABLES[i]] = await readAll(admin, SHARED_TABLES[i]);
  out.billing_invoices = await readAll(admin, "billing_invoices", (q) => q.eq("owner_id", ownerId));
  out.billing_payments = await readAll(admin, "billing_payments", (q) => q.eq("owner_id", ownerId));
  const ids = out.billing_invoices.map((r) => r.id as string);
  const lines: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    (await readAll(admin, "billing_invoice_lines", (q) => q.in("invoice_id", chunk))).forEach((l) => lines.push(l));
  }
  out.billing_invoice_lines = lines;
  return out;
}

function tableCsv(rows: Record<string, unknown>[]): string {
  const head: string[] = [];
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (head.indexOf(k) === -1) head.push(k); }));
  return toCsv(head, rows.map((r) => head.map((k) => {
    const v = r[k];
    return v != null && typeof v === "object" ? JSON.stringify(v) : v;
  })));
}

export async function backupZip(dump: Record<string, Record<string, unknown>[]>): Promise<Uint8Array> {
  const zip = new JSZip();
  Object.keys(dump).forEach((t) => zip.file(`${t}.csv`, tableCsv(dump[t])));
  zip.file("README.txt", `YachtPics billing backup — ${todayET()}\r\nOne CSV per table. Amounts are dollars; dates are YYYY-MM-DD.\r\n`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** The weekly backup: write today's JSON to R2 and prune to the newest 12. */
export async function writeWeeklyBackup(admin: SupabaseClient): Promise<{ key: string; rows: number; pruned: number }> {
  if (!r2VideoConfigured()) throw new Error("R2 private bucket isn't configured (R2_* / R2_VIDEO_BUCKET).");
  const dump = await dumpAll(admin);
  let rows = 0;
  Object.keys(dump).forEach((t) => { rows += dump[t].length; });
  const key = `${BACKUP_PREFIX}${todayET()}.json`;
  const body = Buffer.from(JSON.stringify({ made_at: new Date().toISOString(), tables: dump }));
  await r2VideoPut(key, body, "application/json");
  const existing = (await r2VideoListPrefix(BACKUP_PREFIX)).filter((o) => /\d{4}-\d{2}-\d{2}\.json$/.test(o.key));
  existing.sort((a, b) => (a.key < b.key ? 1 : -1));
  const old = existing.slice(KEEP);
  for (let i = 0; i < old.length; i++) await r2VideoDelete(old[i].key);
  return { key, rows, pruned: old.length };
}
