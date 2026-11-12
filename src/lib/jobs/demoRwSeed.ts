/**
 * Background jobs for the private FILMING account — the writable demo
 * (Nov 12, 2026). See src/lib/demo.ts and docs/where-we-are.md. Registered in
 * ./runner.ts.
 *
 *   demo_rw_seed   Idempotent. Creates (or re-asserts) the filming login
 *                  "Sam Carter" (FILMING_EMAIL), app_metadata
 *                  { demo: true, demo_rw: true }, profile (broker, out of
 *                  every email audience, already "welcomed"), broker details,
 *                  a comped subscription, and its demo_accounts row
 *                  (writable = true, no listing). NO listings: the clip starts
 *                  from an empty account. Then signs the account out
 *                  everywhere (its own sessions only).
 *   demo_rw_reset  Deletes every listing the filming account owns, with their
 *                  rows and files, then sweeps what's left in its own folders.
 *                  Every file path is asserted to sit under `{filmingUserId}/`
 *                  (or `reel-shares/{its listing id}/` for Send-to-phone
 *                  files) before anything is removed; anything else stops the
 *                  job (JobFatalError). The login is kept. Resumable: a batch
 *                  that runs out of time carries on next batch.
 *
 * Neither job ever touches the read-only demo (demoSeed.ts) or any other
 * broker's rows or files.
 *
 * Queue by SQL (the jobs worker / once-a-minute tick picks it up):
 *   insert into public.jobs (kind, params) values ('demo_rw_seed', '{}'::jsonb);
 *   insert into public.jobs (kind, params) values ('demo_rw_reset', '{}'::jsonb);
 */
import { randomBytes } from "crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_VIDEO_BUCKET, r2VideoConfigured, r2VideoDelete } from "@/lib/r2";
import { PHOTO_BUCKET, R2_PHOTO_BUCKET, r2PhotoKey, r2PhotosConfigured, deleteOriginals } from "@/lib/photoStore";
import { removeDerivatives } from "@/lib/photoDerivatives";
import { allDerivativePaths, downloadSizePath, DOWNLOAD_SIZE_EDGES, type DownloadSizeName } from "@/lib/photoDerivativePaths";
import { REEL_SHARE_PREFIX } from "@/lib/videoUploadTarget";
import { FILMING_COMPANY, FILMING_EMAIL, FILMING_FIRST_NAME, FILMING_LAST_NAME, isDemoUser, isWritableDemoUser } from "@/lib/demo";
import { forgetDemoAccounts, readDemoAccountRows, type DemoAccountRow } from "@/lib/demoServer";
import { allRows, findUserByEmail, listR2, revokeDemoSessions } from "./demoSeed";
import { JobFatalError, type JobHandler } from "./types";

const VIDEO_BUCKET_SUPABASE = "listing-videos";
const DOCUMENT_BUCKET = "listing-documents";
/** Stop starting new work this long before the batch deadline. */
const MARGIN_MS = 8_000;

const isUuid = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x);

async function readFilmingAccount(svc: SupabaseClient): Promise<DemoAccountRow | null> {
  const rows = await readDemoAccountRows(svc);
  if (rows === null) throw new JobFatalError("The demo tables aren't there yet — apply migrations 20261110_demo_link.sql and 20261112_demo_rw_filming_account.sql first.");
  return rows.find((r) => r.writable) ?? null;
}

/** `{userId}/` — the one folder every filming-account file must live under. */
function filmingFolder(userId: string): string {
  if (!isUuid(userId)) throw new JobFatalError("Filming account id is malformed — refusing to touch files.");
  return `${userId}/`;
}

/** THE guard for every path demo_rw_reset deletes. */
function assertUnder(folder: string, path: string): void {
  if (
    typeof path !== "string" ||
    !folder ||
    !path.startsWith(folder) ||
    path.length <= folder.length ||
    path.indexOf("..") >= 0 ||
    path.indexOf("//") >= 0 ||
    path.startsWith("/")
  ) {
    throw new JobFatalError(`Refusing to touch "${String(path).slice(0, 120)}" — it isn't inside ${folder || "(no folder)"}.`);
  }
}

// ─── demo_rw_seed ───────────────────────────────────────────────────────────

export const demoRwSeed: JobHandler = async (_job, { svc }) => {
  const log: string[] = [];
  const account = await readFilmingAccount(svc);
  let user: User | null = null;

  if (account) {
    const { data, error } = await svc.auth.admin.getUserById(account.user_id);
    if (!error && data?.user) user = data.user;
    if (user && !isDemoUser(user)) {
      throw new JobFatalError("The writable demo_accounts row points at a user without the demo claim — refusing. Check it by hand.");
    }
  }

  // A long random password nobody knows; the account is only ever entered
  // through /demo/{token} (which sets another fresh one each time).
  const password = randomBytes(48).toString("base64url");
  const appMeta = { demo: true, demo_rw: true };
  const userMeta = { role: "broker", first_name: FILMING_FIRST_NAME, last_name: FILMING_LAST_NAME };

  if (!user) {
    const { data, error } = await svc.auth.admin.createUser({
      email: FILMING_EMAIL,
      password,
      email_confirm: true,
      app_metadata: appMeta,
      user_metadata: userMeta,
    });
    if (data?.user) {
      user = data.user;
      log.push("Filming login created.");
    } else {
      const existing = await findUserByEmail(svc, FILMING_EMAIL);
      if (!existing) throw new Error(`createUser: ${error?.message ?? "no user returned"}`);
      if (!isDemoUser(existing)) {
        throw new JobFatalError(`${FILMING_EMAIL} already belongs to a login WITHOUT the demo claim — not touching it.`);
      }
      user = existing;
      log.push("Found the existing filming login.");
    }
  }
  const userId = user.id;

  // Never the read-only demo's login.
  const rows = (await readDemoAccountRows(svc)) ?? [];
  if (rows.some((r) => !r.writable && r.user_id === userId)) {
    throw new JobFatalError("That login is the read-only demo — refusing to make it writable.");
  }

  // Re-assert (undoes anything changed through Supabase Auth since last run).
  const { error: upErr } = await svc.auth.admin.updateUserById(userId, {
    email: FILMING_EMAIL,
    email_confirm: true,
    password,
    app_metadata: { ...(user.app_metadata ?? {}), ...appMeta },
    user_metadata: userMeta,
    ban_duration: "none",
  });
  if (upErr) throw new Error(`updateUserById: ${upErr.message}`);
  try {
    const { data: factors } = await svc.auth.admin.mfa.listFactors({ userId });
    for (const f of factors?.factors ?? []) {
      await svc.auth.admin.mfa.deleteFactor({ id: f.id, userId }).catch(() => {});
      log.push("Removed an MFA factor someone added to the filming login.");
    }
  } catch { /* MFA not enabled on the project */ }

  // Profile — a broker, out of every email audience, never "welcomed"
  // (the dashboard sends a welcome email when welcomed_at is null).
  const { data: prof } = await svc.from("profiles").select("welcomed_at").eq("id", userId).maybeSingle();
  const { error: pErr } = await svc.from("profiles").upsert({
    id: userId,
    role: "broker",
    first_name: FILMING_FIRST_NAME,
    last_name: FILMING_LAST_NAME,
    display_email: FILMING_EMAIL,
    email_opt_out: true,
    notify_on_view: false,
    welcomed_at: (prof?.welcomed_at as string | null) ?? new Date().toISOString(),
  }, { onConflict: "id" });
  if (pErr) throw new Error(`profiles: ${pErr.message}`);

  const { error: bdErr } = await svc
    .from("broker_details")
    .upsert({ id: userId, brokerage_name: FILMING_COMPANY }, { onConflict: "id" });
  if (bdErr) log.push(`broker_details not saved (${bdErr.message}) — the account shows no company.`);

  // Comped like the read-only demo: active, no Stripe subscription (isComped).
  const { error: sErr } = await svc
    .from("subscriptions")
    .upsert({ broker_id: userId, status: "active", stripe_subscription_id: null, stripe_price_id: null, current_period_end: null }, { onConflict: "broker_id" });
  if (sErr) throw new Error(`subscriptions: ${sErr.message}`);

  // The row that makes it a (writable) demo account — every "leave the demo
  // out" rule keys on demo_accounts, so this goes in before anything else uses it.
  const { error: aErr } = await svc
    .from("demo_accounts")
    .upsert({ user_id: userId, email: FILMING_EMAIL, writable: true, listing_id: null, source_listing_id: null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (aErr) {
    if (/writable/i.test(aErr.message)) throw new JobFatalError("demo_accounts has no `writable` column — apply migration 20261112_demo_rw_filming_account.sql first.");
    throw new Error(`demo_accounts: ${aErr.message}`);
  }
  forgetDemoAccounts();

  const { count } = await svc.from("listings").select("id", { count: "exact", head: true }).eq("broker_id", userId);
  if ((count ?? 0) > 0) log.push(`The filming account already has ${count} listing${count === 1 ? "" : "s"} — queue demo_rw_reset for an empty start.`);

  await revokeDemoSessions(svc, log, userId);
  log.push("Filming account ready — mint a link (docs/where-we-are.md) and open /demo/{token}.");
  return { cursor: null, done: 1, failed: 0, total: 1, log, finished: true };
};

// ─── demo_rw_reset ──────────────────────────────────────────────────────────

/** Every object under `dir` in a Supabase bucket, folders followed (depth ≤ 4). */
async function listSupabaseDeep(svc: SupabaseClient, bucket: string, dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 4 || out.length > 20_000) return out;
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const { data, error } = await svc.storage.from(bucket).list(dir, { limit: 1000, offset });
    if (error || !data) break;
    for (const o of data) {
      const full = `${dir}/${o.name}`;
      if (o.id) out.push(full);
      else await listSupabaseDeep(svc, bucket, full, depth + 1, out);
    }
    if (data.length < 1000) break;
  }
  return out;
}

/** Rows that hang off a listing (best effort — a missing table is fine). */
const LISTING_SIDE_TABLES = [
  "slideshow_events", "slideshow_views", "listing_leads", "client_sends", "reel_events",
  "listing_show_entries", "photo_downloads", "reel_claims", "showcase_events",
];

export const demoRwReset: JobHandler = async (_job, { svc, deadlineMs }) => {
  const log: string[] = [];
  const account = await readFilmingAccount(svc);
  if (!account) return { cursor: null, done: 0, failed: 0, total: 0, log: ["No filming account — nothing to reset."], finished: true };
  const userId = account.user_id;
  const { data: u } = await svc.auth.admin.getUserById(userId);
  if (!u?.user || !isWritableDemoUser(u.user)) {
    throw new JobFatalError("The writable demo_accounts user has no demo_rw claim — refusing to delete anything.");
  }
  // Never the read-only demo's login or its sample boat.
  const rows = (await readDemoAccountRows(svc)) ?? [];
  if (rows.some((r) => !r.writable && r.user_id === userId)) throw new JobFatalError("That login is the read-only demo — refusing.");
  const protectedListings = rows.map((r) => r.listing_id).concat(rows.map((r) => r.source_listing_id)).filter(isUuid);
  const folder = filmingFolder(userId);

  const listings = await allRows<{ id: string; broker_id: string; deck_plan_path: string | null }>((a, b) =>
    svc.from("listings").select("id, broker_id, deck_plan_path").eq("broker_id", userId).range(a, b));
  let removed = 0;
  for (const listing of listings) {
    if (Date.now() > deadlineMs - MARGIN_MS) {
      log.push(`${removed} listing${removed === 1 ? "" : "s"} removed — out of time, carrying on next batch.`);
      return { cursor: null, done: removed, failed: 0, log, finished: false };
    }
    if (listing.broker_id !== userId || !isUuid(listing.id)) throw new JobFatalError("A listing isn't the filming account's — refusing.");
    if (protectedListings.indexOf(listing.id) >= 0) throw new JobFatalError("A filming listing is the read-only demo's boat — refusing.");
    const listingId = listing.id;

    // Photos: originals (both stores), derivatives, download sizes — every path checked first.
    const photos = await allRows<{ id: string; storage_path: string }>((a, b) =>
      svc.from("photos").select("id, storage_path").eq("listing_id", listingId).range(a, b));
    photos.forEach((p) => {
      assertUnder(folder, p.storage_path);
      allDerivativePaths(p).forEach((d) => assertUnder(folder, d));
      (Object.keys(DOWNLOAD_SIZE_EDGES) as DownloadSizeName[]).forEach((n) => assertUnder(folder, downloadSizePath(p, n)));
    });
    for (let i = 0; i < photos.length; i += 200) {
      const chunk = photos.slice(i, i + 200);
      await deleteOriginals(svc, chunk.map((p) => p.storage_path));
      await removeDerivatives(svc, chunk);
      const { error } = await svc.from("photos").delete().in("id", chunk.map((p) => p.id)).eq("listing_id", listingId);
      if (error) throw new Error(`photos: ${error.message}`);
    }

    // Videos (R2 or Supabase) + their stills.
    const { data: vids } = await svc.from("videos").select("id, storage_path, storage_host, thumbnail_path").eq("listing_id", listingId);
    const videos = (vids ?? []) as { id: string; storage_path: string; storage_host: string | null; thumbnail_path: string | null }[];
    videos.forEach((v) => { assertUnder(folder, v.storage_path); if (v.thumbnail_path) assertUnder(folder, v.thumbnail_path); });
    for (const v of videos) {
      if (v.storage_host === "r2" && r2VideoConfigured()) await r2VideoDelete(v.storage_path).catch(() => {});
      else await svc.storage.from(VIDEO_BUCKET_SUPABASE).remove([v.storage_path]).then(() => {}, () => {});
      if (v.thumbnail_path) await svc.storage.from(PHOTO_BUCKET).remove([v.thumbnail_path]).then(() => {}, () => {});
    }
    if (videos.length) {
      const { error } = await svc.from("videos").delete().in("id", videos.map((v) => v.id)).eq("listing_id", listingId);
      if (error) throw new Error(`videos: ${error.message}`);
    }

    // Documents.
    const { data: docs } = await svc.from("documents").select("id, storage_path").eq("listing_id", listingId);
    const documents = (docs ?? []) as { id: string; storage_path: string }[];
    documents.forEach((d) => assertUnder(folder, d.storage_path));
    if (documents.length) {
      await svc.storage.from(DOCUMENT_BUCKET).remove(documents.map((d) => d.storage_path)).then(() => {}, () => {});
      const { error } = await svc.from("documents").delete().in("id", documents.map((d) => d.id)).eq("listing_id", listingId);
      if (error) throw new Error(`documents: ${error.message}`);
    }

    if (listing.deck_plan_path) {
      assertUnder(folder, listing.deck_plan_path);
      await svc.storage.from(PHOTO_BUCKET).remove([listing.deck_plan_path]).then(() => {}, () => {});
    }

    // Send-to-my-phone reel files: reel-shares/{listingId}/… (swept after two
    // days anyway; removed now so nothing outlives the reset).
    if (r2VideoConfigured()) {
      const sharePrefix = `${REEL_SHARE_PREFIX}${listingId}/`;
      const keys = await listR2(R2_VIDEO_BUCKET, sharePrefix);
      for (const k of keys) {
        assertUnder(sharePrefix, k);
        await r2VideoDelete(k).catch(() => {});
      }
    }

    for (const t of LISTING_SIDE_TABLES) {
      await svc.from(t).delete().eq("listing_id", listingId).then(() => {}, () => {});
    }
    const { error: lErr } = await svc.from("listings").delete().eq("id", listingId).eq("broker_id", userId);
    if (lErr) throw new Error(`listing ${listingId.slice(0, 8)}…: ${lErr.message}`);
    removed++;
  }
  if (removed) log.push(`${removed} filming listing${removed === 1 ? "" : "s"} removed.`);

  // Sweep anything left in the account's OWN folders (uploads whose row was
  // never written, derivatives, stills). Every key is checked first.
  if (Date.now() > deadlineMs - MARGIN_MS) return { cursor: null, done: removed, failed: 0, log: log.concat("Sweep next batch."), finished: false };
  const base = folder.replace(/\/$/, "");
  let swept = 0;
  for (const bucket of [PHOTO_BUCKET, DOCUMENT_BUCKET, VIDEO_BUCKET_SUPABASE]) {
    const paths = await listSupabaseDeep(svc, bucket, base);
    paths.forEach((p) => assertUnder(folder, p));
    for (let i = 0; i < paths.length; i += 500) {
      await svc.storage.from(bucket).remove(paths.slice(i, i + 500)).then(() => {}, () => {});
    }
    swept += paths.length;
  }
  if (r2PhotosConfigured()) {
    const keyPrefix = r2PhotoKey(folder);
    const keys = await listR2(R2_PHOTO_BUCKET, keyPrefix);
    for (const k of keys) {
      if (!k.startsWith(keyPrefix)) throw new JobFatalError(`R2 listed ${k} outside ${keyPrefix} — stopping.`);
      assertUnder(folder, k.slice(`photos/${PHOTO_BUCKET}/`.length));
      await r2().send(new DeleteObjectCommand({ Bucket: R2_PHOTO_BUCKET, Key: k })).catch(() => {});
    }
    swept += keys.length;
  }
  if (r2VideoConfigured()) {
    const keys = await listR2(R2_VIDEO_BUCKET, folder);
    for (const k of keys) {
      assertUnder(folder, k);
      await r2VideoDelete(k).catch(() => {});
    }
    swept += keys.length;
  }
  if (swept) log.push(`${swept} leftover file${swept === 1 ? "" : "s"} in the filming account's folders removed.`);

  forgetDemoAccounts();
  await revokeDemoSessions(svc, log, userId);
  log.push("Filming reset done. The login is kept; mint a new link to start again.");
  return { cursor: null, done: removed, failed: 0, total: listings.length, log, finished: true };
};
