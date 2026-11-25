import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumn } from "@/lib/books/invoices";
import { normalizeHex } from "@/lib/reelStyles";
import { LOGO_BUCKET, logoFileError, storeBrokerLogoFile } from "@/lib/brokerLogoUpload";
import type { LogoBookends } from "@/lib/logoBookends";

/**
 * Logo bookends — the server side (Nov 25, 2026). SERVER ONLY (service client).
 * What a bookend is and how it is drawn: src/lib/logoBookends.ts.
 *
 * Who gets which set: the broker's OFFICE set when their brokerage has one
 * switched on (it wins for every broker in the brokerage), otherwise the
 * broker's OWN set when switched on, otherwise none.
 *
 * Before migration 20261125c_logo_bookends.sql is applied the columns don't
 * exist: every read here answers "off" / "not available" and every write is
 * refused with BOOKENDS_UNAVAILABLE (409). The bookend columns are only ever
 * read in their own queries, never added to an existing select, so nothing
 * else breaks either way. Nothing here throws.
 */

export const BOOKENDS_UNAVAILABLE = "This switches on once the database update is applied.";

export type BookendTarget = { kind: "broker"; id: string } | { kind: "office"; id: string };
export type BookendWhich = "open" | "close";

/** A target's own settings, as stored (URLs already checked). */
export type BookendSettings = { on: boolean; openUrl: string | null; closeUrl: string | null; ground: string | null };

export type BookendResult = { ok: true; settings: BookendSettings } | { ok: false; error: string; status: number };

const COLS = "bookend_on, bookend_open_url, bookend_close_url, bookend_ground";

type Row = {
  bookend_on: boolean | null;
  bookend_open_url: string | null;
  bookend_close_url: string | null;
  bookend_ground: string | null;
};

const tableFor = (t: BookendTarget) => (t.kind === "office" ? "brokerages" : "broker_details");

/** Only images in our own public logo bucket are ever drawn. */
export function bookendUrlOk(u: unknown): u is string {
  if (typeof u !== "string" || !u) return false;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (!base) return false;
  return u.startsWith(`${base}/storage/v1/object/public/${LOGO_BUCKET}/`);
}

function settingsOf(row: Row | null): BookendSettings {
  return {
    on: row?.bookend_on === true,
    openUrl: bookendUrlOk(row?.bookend_open_url) ? (row!.bookend_open_url as string) : null,
    closeUrl: bookendUrlOk(row?.bookend_close_url) ? (row!.bookend_close_url as string) : null,
    ground: normalizeHex(row?.bookend_ground),
  };
}

/** The set a row gives when it is switched on and complete, else null. One image serves both ends. */
function setOf(row: Row | null): LogoBookends | null {
  const s = settingsOf(row);
  if (!s.on || !s.ground) return null;
  const open = s.openUrl ?? s.closeUrl;
  const close = s.closeUrl ?? s.openUrl;
  if (!open || !close) return null;
  return { openUrl: open, closeUrl: close, ground: s.ground };
}

/** The target's row. `available: false` = the migration isn't applied. */
async function readRow(svc: SupabaseClient, target: BookendTarget): Promise<{ row: Row | null; available: boolean }> {
  try {
    const { data, error } = await svc.from(tableFor(target)).select(COLS).eq("id", target.id).maybeSingle();
    if (error) return { row: null, available: !isMissingColumn(error) };
    return { row: (data as Row | null) ?? null, available: true };
  } catch {
    return { row: null, available: false };
  }
}

/** Are the bookend columns in the database yet? */
export async function bookendsAvailable(svc: SupabaseClient): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([
      svc.from("broker_details").select("bookend_on").limit(1),
      svc.from("brokerages").select("bookend_on").limit(1),
    ]);
    return !isMissingColumn(a.error) && !isMissingColumn(b.error) && !a.error && !b.error;
  } catch {
    return false;
  }
}

/**
 * The bookends a broker's reels and slideshows open and close with, or null.
 * Office first (when on and complete), then the broker's own. Cached per
 * request (the slideshow page and its helpers may ask more than once).
 */
export const resolveLogoBookends = cache(async (svc: SupabaseClient, brokerId: string | null | undefined): Promise<LogoBookends | null> => {
  if (!brokerId) return null;
  try {
    const { data: prof } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).maybeSingle();
    const officeId = (prof?.brokerage_id as string | null | undefined) ?? null;
    if (officeId) {
      const office = await readRow(svc, { kind: "office", id: officeId });
      if (!office.available) return null;
      const set = setOf(office.row);
      if (set) return set;
    }
    const own = await readRow(svc, { kind: "broker", id: brokerId });
    return own.available ? setOf(own.row) : null;
  } catch {
    return null;
  }
});

/** The broker's office and whether its set is the one in use. Null = no office (or not available). */
export async function officeBookendStatus(svc: SupabaseClient, brokerId: string): Promise<{ id: string; name: string; on: boolean } | null> {
  try {
    const { data: prof } = await svc.from("profiles").select("brokerage_id").eq("id", brokerId).maybeSingle();
    const officeId = (prof?.brokerage_id as string | null | undefined) ?? null;
    if (!officeId) return null;
    const [{ data: b }, office] = await Promise.all([
      svc.from("brokerages").select("name").eq("id", officeId).maybeSingle(),
      readRow(svc, { kind: "office", id: officeId }),
    ]);
    if (!office.available) return null;
    return { id: officeId, name: ((b?.name as string | null) ?? "").trim() || "your office", on: setOf(office.row) !== null };
  } catch {
    return null;
  }
}

/** A target's own settings, or null when the feature isn't available yet. */
export async function readBookendSettings(svc: SupabaseClient, target: BookendTarget): Promise<BookendSettings | null> {
  const r = await readRow(svc, target);
  return r.available ? settingsOf(r.row) : null;
}

/** Write columns on the target's row (a broker may not have a broker_details row yet). */
async function writeRow(svc: SupabaseClient, target: BookendTarget, fields: Record<string, unknown>): Promise<{ error: string | null; missing: boolean }> {
  try {
    const q = target.kind === "broker"
      ? svc.from("broker_details").upsert({ id: target.id, ...fields }, { onConflict: "id" })
      : svc.from("brokerages").update(fields).eq("id", target.id);
    const { error } = await q;
    if (!error) return { error: null, missing: false };
    return { error: error.message, missing: isMissingColumn(error) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), missing: false };
  }
}

async function after(svc: SupabaseClient, target: BookendTarget): Promise<BookendResult> {
  const s = await readBookendSettings(svc, target);
  return s ? { ok: true, settings: s } : { ok: false, error: BOOKENDS_UNAVAILABLE, status: 409 };
}

/**
 * Store an opening or closing image and point the row at it. Availability is
 * checked BEFORE the upload, so a refused save never leaves a file behind.
 */
export async function saveBookendImage(svc: SupabaseClient, target: BookendTarget, which: BookendWhich, file: File): Promise<BookendResult> {
  if (!(await bookendsAvailable(svc))) return { ok: false, error: BOOKENDS_UNAVAILABLE, status: 409 };
  const invalid = logoFileError(file);
  if (invalid) return { ok: false, error: invalid, status: 400 };
  const folder = target.kind === "office" ? `office/${target.id}` : target.id;
  const stored = await storeBrokerLogoFile(svc, target.id, file, { folder, name: `bookend-${which}` });
  if (stored.error !== undefined) return { ok: false, error: stored.error, status: 500 };
  const w = await writeRow(svc, target, { [which === "open" ? "bookend_open_url" : "bookend_close_url"]: stored.url });
  if (w.error) return { ok: false, error: w.missing ? BOOKENDS_UNAVAILABLE : `Couldn’t save: ${w.error}`, status: w.missing ? 409 : 500 };
  return after(svc, target);
}

/**
 * Switch on or off, and/or set the colour. Turning on needs at least one image
 * and a valid colour (the one sent, or the one already saved).
 */
export async function saveBookendSettings(
  svc: SupabaseClient,
  target: BookendTarget,
  body: { on?: unknown; ground?: unknown }
): Promise<BookendResult> {
  const current = await readBookendSettings(svc, target);
  if (!current) return { ok: false, error: BOOKENDS_UNAVAILABLE, status: 409 };
  const fields: Record<string, unknown> = {};
  let ground = current.ground;
  if (body.ground !== undefined) {
    if (body.ground === null || body.ground === "") {
      ground = null;
    } else {
      const g = normalizeHex(body.ground);
      if (!g) return { ok: false, error: "Enter the colour as a hex code, like #040847.", status: 400 };
      ground = g;
    }
    fields.bookend_ground = ground;
  }
  if (body.on !== undefined) {
    const on = body.on === true;
    if (on && !current.openUrl && !current.closeUrl) {
      return { ok: false, error: "Upload an opening or closing logo first.", status: 400 };
    }
    if (on && !ground) return { ok: false, error: "Pick a background colour first.", status: 400 };
    fields.bookend_on = on;
  }
  // Clearing the colour while on switches it off (a frame needs a colour).
  if (ground === null && (fields.bookend_on ?? current.on) === true) fields.bookend_on = false;
  if (Object.keys(fields).length === 0) return { ok: true, settings: current };
  const w = await writeRow(svc, target, fields);
  if (w.error) return { ok: false, error: w.missing ? BOOKENDS_UNAVAILABLE : `Couldn’t save: ${w.error}`, status: w.missing ? 409 : 500 };
  return after(svc, target);
}

/**
 * Take an image off. The file stays in storage (the next upload overwrites
 * it), as the logo's Remove does. With no image left, it switches off.
 */
export async function clearBookendImage(svc: SupabaseClient, target: BookendTarget, which: BookendWhich): Promise<BookendResult> {
  const current = await readBookendSettings(svc, target);
  if (!current) return { ok: false, error: BOOKENDS_UNAVAILABLE, status: 409 };
  const otherLeft = which === "open" ? current.closeUrl : current.openUrl;
  const fields: Record<string, unknown> = { [which === "open" ? "bookend_open_url" : "bookend_close_url"]: null };
  if (!otherLeft) fields.bookend_on = false;
  const w = await writeRow(svc, target, fields);
  if (w.error) return { ok: false, error: w.missing ? BOOKENDS_UNAVAILABLE : `Couldn’t save: ${w.error}`, status: w.missing ? 409 : 500 };
  return after(svc, target);
}

export function parseWhich(v: unknown): BookendWhich | null {
  return v === "open" || v === "close" ? v : null;
}
