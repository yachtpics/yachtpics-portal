/**
 * Background jobs for the read-only DEMO account (Nov 10, 2026) — see
 * src/lib/demo.ts and docs/where-we-are.md. Registered in ./runner.ts.
 *
 *   demo_seed   Idempotent, resumable. Creates (or re-asserts) the demo auth
 *               user + profile + comped subscription, then builds an
 *               INDEPENDENT copy of the source listing ("Short Story"):
 *               its own listing row (pocket listing, never on the website or
 *               the showcase), its own copies of every photo ORIGINAL in the
 *               demo broker's own folder (same bucket / backend the source
 *               photo uses), new photos rows in the same order with the same
 *               categories, visibility and cover, derivatives + download
 *               sizes made by the normal code paths, the two shortest
 *               videos, its own published slideshow slug, and a modest set
 *               of SAMPLE engagement rows. Photos already copied are skipped,
 *               so re-running (or a crashed batch) just carries on.
 *   demo_reset  Removes the demo listing's rows and ITS OWN files only. Every
 *               file path it deletes is asserted to sit under
 *               `{demoUserId}/{demoListingId}/` first; anything else stops
 *               the job (JobFatalError) before a single file is removed.
 *
 * Neither job ever writes to, or deletes from, the source listing: it is only
 * read (select) and its files are only the SOURCE of server-side copies.
 *
 * Queue either by SQL (the jobs worker / once-a-minute tick picks it up):
 *   insert into public.jobs (kind, params) values ('demo_seed', '{}'::jsonb);
 *   insert into public.jobs (kind, params) values ('demo_reset', '{}'::jsonb);
 */
import { randomBytes } from "crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { r2, R2_VIDEO_BUCKET, r2VideoConfigured, r2VideoCopy, r2VideoDelete } from "@/lib/r2";
import { PHOTO_BUCKET, R2_PHOTO_BUCKET, r2PhotoKey, r2PhotosConfigured, noteR2PhotoExists, deleteOriginals } from "@/lib/photoStore";
import { ensureDerivatives, removeDerivatives } from "@/lib/photoDerivatives";
import { allDerivativePaths, downloadSizePath, downloadSizesErrorRecord, DOWNLOAD_SIZE_EDGES, type DownloadSizeName } from "@/lib/photoDerivativePaths";
import { newSlideshowSlug } from "@/lib/slideshowPublish";
import { DEMO_COMPANY, DEMO_EMAIL, DEMO_FIRST_NAME, DEMO_LAST_NAME, isDemoUser, isWritableDemoUser } from "@/lib/demo";
import { forgetDemoAccounts, readDemoAccountRows } from "@/lib/demoServer";
import { JobFatalError, type JobHandler, type StepResult } from "./types";

/** "Short Story" — the listing the demo copies. */
export const DEMO_SOURCE_LISTING_ID = "e08da4be-e652-4b30-a611-566850c8a920";
const VIDEO_BUCKET_SUPABASE = "listing-videos";
const MAX_VIDEOS = 2;
const COPY_CONCURRENCY = 3;
/** Stop starting new work this long before the batch deadline. */
const MARGIN_MS = 8_000;

const SITE_BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://portal.yachtpics.com").replace(/\/+$/, "");
const DEMO_LOGO_URL = `${SITE_BASE}/brand/yachtpics-logo-dark.png`;

type Phase = "identity" | "listing" | "photos" | "derive" | "videos" | "engagement" | "done";
type SeedCursor = { phase?: Phase; skip?: string[] };

type AccountRow = { user_id: string; email: string | null; listing_id: string | null; source_listing_id: string | null };

const isUuid = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

function sourceListingId(params: Record<string, unknown>): string {
  return isUuid(params.sourceListingId) ? params.sourceListingId : DEMO_SOURCE_LISTING_ID;
}

/**
 * The READ-ONLY demo's row: the oldest demo_accounts row that isn't the
 * writable filming account (Nov 12 — that one belongs to demoRwSeed.ts).
 */
async function readAccount(svc: SupabaseClient): Promise<AccountRow | null> {
  const rows = await readDemoAccountRows(svc);
  if (rows === null) throw new JobFatalError("The demo tables aren't there yet — apply migration 20261110_demo_link.sql first.");
  const row = rows.find((r) => !r.writable);
  return row ? { user_id: row.user_id, email: row.email, listing_id: row.listing_id, source_listing_id: row.source_listing_id } : null;
}

/** The folder every demo file must live under. */
function demoFolder(userId: string, listingId: string): string {
  if (!isUuid(userId) || !isUuid(listingId)) throw new JobFatalError("Demo ids are malformed — refusing to touch files.");
  return `${userId}/${listingId}/`;
}

/**
 * THE guard for every path the demo jobs write or delete. Throws (fatal) if
 * the path isn't plainly inside the demo listing's own folder.
 */
function assertUnder(folder: string, path: string): void {
  if (
    typeof path !== "string" ||
    !path.startsWith(folder) ||
    path.length <= folder.length ||
    path.indexOf("..") >= 0 ||
    path.indexOf("//") >= 0 ||
    path.startsWith("/")
  ) {
    throw new JobFatalError(`Refusing to touch "${String(path).slice(0, 120)}" — it isn't inside the demo folder ${folder}.`);
  }
}

function baseName(path: string): string {
  const name = (path.split("/").pop() || "file").replace(/[^A-Za-z0-9._-]/g, "_");
  return name.slice(-120) || "file";
}

/** Copy only these keys, and only when the source row has them. */
function pick(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  keys.forEach((k) => { if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k]; });
  return out;
}

// ─── identity ───────────────────────────────────────────────────────────────

export async function findUserByEmail(svc: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (users.length < 1000) return null;
  }
  return null;
}

/**
 * Create the demo user if missing and re-assert everything a demo session
 * could have changed through Supabase Auth directly (email, password,
 * metadata, MFA factors). Returns the demo user's id.
 */
async function ensureIdentity(svc: SupabaseClient, sourceId: string, log: string[]): Promise<string> {
  const account = await readAccount(svc);
  let user: User | null = null;

  if (account) {
    const { data, error } = await svc.auth.admin.getUserById(account.user_id);
    if (!error && data?.user) user = data.user;
    if (user && (!isDemoUser(user) || isWritableDemoUser(user))) {
      throw new JobFatalError("demo_accounts points at a user without the read-only demo claim — refusing. Check it by hand.");
    }
  }

  // A long random password nobody knows. Never stored, never logged; the
  // demo is only ever entered through /demo/{token}.
  const password = randomBytes(48).toString("base64url");

  if (!user) {
    const { data, error } = await svc.auth.admin.createUser({
      email: DEMO_EMAIL,
      password,
      email_confirm: true,
      app_metadata: { demo: true },
      user_metadata: { role: "broker", first_name: DEMO_FIRST_NAME, last_name: DEMO_LAST_NAME },
    });
    if (data?.user) {
      user = data.user;
      log.push("Demo login created.");
    } else {
      const existing = await findUserByEmail(svc, DEMO_EMAIL);
      if (!existing) throw new Error(`createUser: ${error?.message ?? "no user returned"}`);
      if (!isDemoUser(existing) || isWritableDemoUser(existing)) {
        throw new JobFatalError(`${DEMO_EMAIL} already belongs to a login WITHOUT the read-only demo claim — not touching it.`);
      }
      user = existing;
      log.push("Found the existing demo login.");
    }
  }
  const userId = user.id;

  // Re-assert (undoes anything changed through Supabase Auth since last run).
  const { error: upErr } = await svc.auth.admin.updateUserById(userId, {
    email: DEMO_EMAIL,
    email_confirm: true,
    password,
    app_metadata: { ...(user.app_metadata ?? {}), demo: true, demo_rw: false },
    user_metadata: { role: "broker", first_name: DEMO_FIRST_NAME, last_name: DEMO_LAST_NAME },
    ban_duration: "none",
  });
  if (upErr) throw new Error(`updateUserById: ${upErr.message}`);
  try {
    const { data: factors } = await svc.auth.admin.mfa.listFactors({ userId });
    for (const f of factors?.factors ?? []) {
      await svc.auth.admin.mfa.deleteFactor({ id: f.id, userId }).catch(() => {});
      log.push("Removed an MFA factor someone added to the demo login.");
    }
  } catch { /* MFA not enabled on the project */ }

  // Profile — a broker, out of every email audience, never "welcomed"
  // (the dashboard sends a welcome email when welcomed_at is null).
  const { data: prof } = await svc.from("profiles").select("welcomed_at").eq("id", userId).maybeSingle();
  const profile: Record<string, unknown> = {
    id: userId,
    role: "broker",
    first_name: DEMO_FIRST_NAME,
    last_name: DEMO_LAST_NAME,
    display_email: DEMO_EMAIL,
    email_opt_out: true,
    notify_on_view: false,
    welcomed_at: (prof?.welcomed_at as string | null) ?? new Date().toISOString(),
  };
  const { error: pErr } = await svc.from("profiles").upsert(profile, { onConflict: "id" });
  if (pErr) throw new Error(`profiles: ${pErr.message}`);

  const { error: bdErr } = await svc
    .from("broker_details")
    .upsert({ id: userId, brokerage_name: DEMO_COMPANY, brokerage_website: "https://yachtpics.com", logo_url: DEMO_LOGO_URL }, { onConflict: "id" });
  if (bdErr) log.push(`broker_details not saved (${bdErr.message}) — the demo shows no company/logo.`);

  // Comped = status 'active' with no Stripe subscription (isComped,
  // src/lib/subscriptionAccess.ts) — the same as the Miles Yacht Group
  // brokers. There is no per-tier comp: tier comes only from a real Stripe
  // price. The one tier-only tool (the website) is comped on broker_sites.
  const { error: sErr } = await svc
    .from("subscriptions")
    .upsert({ broker_id: userId, status: "active", stripe_subscription_id: null, stripe_price_id: null, current_period_end: null }, { onConflict: "broker_id" });
  if (sErr) throw new Error(`subscriptions: ${sErr.message}`);

  // Website: the editor shows, but the site is never published (/b/{slug}
  // stays off — brokerSiteServer requires published = true).
  const site = { broker_id: userId, slug: `yachtpics-demo-${userId.slice(0, 6)}`, published: false, billing_status: "comped" };
  let { error: siteErr } = await svc.from("broker_sites").upsert(site, { onConflict: "broker_id" });
  if (siteErr && /billing_status/i.test(siteErr.message)) {
    const { billing_status: _b, ...rest } = site; void _b;
    ({ error: siteErr } = await svc.from("broker_sites").upsert(rest, { onConflict: "broker_id" }));
  }
  if (siteErr) log.push(`Website row not saved (${siteErr.message}) — the Website page shows its set-up state.`);

  const { error: aErr } = await svc
    .from("demo_accounts")
    .upsert({ user_id: userId, email: DEMO_EMAIL, source_listing_id: sourceId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (aErr) throw new Error(`demo_accounts: ${aErr.message}`);
  forgetDemoAccounts();
  return userId;
}

// ─── listing ────────────────────────────────────────────────────────────────

/** Descriptive columns copied from the source (the same set the listing PATCH accepts, plus layout). */
const LISTING_COPY_KEYS = [
  "vessel_name", "vessel_type", "year", "length_ft", "make", "model", "asking_price", "location", "description",
  "beam_ft", "draft_ft", "staterooms", "heads", "engines", "engine_hours", "fuel_type", "cruising_speed_kn",
  "max_speed_kn", "hull_material", "tour_url", "youtube_url", "hero_fit", "photo_order_manual",
];

async function ensureListing(svc: SupabaseClient, userId: string, sourceId: string, log: string[]): Promise<string> {
  const account = await readAccount(svc);
  if (account?.listing_id) {
    const { data: l } = await svc.from("listings").select("id, broker_id").eq("id", account.listing_id).maybeSingle();
    if (l && l.broker_id === userId) return l.id as string;
  }
  const { data: src, error } = await svc.from("listings").select("*").eq("id", sourceId).maybeSingle();
  if (error) throw new Error(`source listing: ${error.message}`);
  if (!src) throw new JobFatalError(`Source listing ${sourceId} not found.`);

  const row: Record<string, unknown> = {
    ...pick(src as Record<string, unknown>, LISTING_COPY_KEYS),
    broker_id: userId,
    status: "active",
    // Pocket listing: never on yachtpics.com, the showcase or the review reel.
    showcase_opt_out: true,
    showcase_opt_out_by: userId,
    showcase_opt_out_at: new Date().toISOString(),
    in_showcase: false,
    publish_to_site: false,
    is_shared: false,
    site_hidden: true,
    // Its own live Client Slideshow.
    slideshow_slug: newSlideshowSlug(),
    slideshow_published: true,
  };
  // Columns that may not exist on every database: drop and retry.
  let attempt = { ...row };
  for (let i = 0; i < 8; i++) {
    const { data, error: insErr } = await svc.from("listings").insert(attempt).select("id").single();
    if (!insErr && data) {
      await svc.from("demo_accounts").update({ listing_id: data.id, updated_at: new Date().toISOString() }).eq("user_id", userId);
      forgetDemoAccounts();
      log.push(`Demo listing created (copy of ${(src as { vessel_name?: string }).vessel_name ?? "the source"}).`);
      return data.id as string;
    }
    const msg = insErr?.message ?? "";
    const col = /column "?([a-z_]+)"? of relation|Could not find the '([a-z_]+)' column/i.exec(msg);
    const name = col ? col[1] || col[2] : null;
    if (name && name in attempt && ["broker_id", "status", "showcase_opt_out", "slideshow_slug", "slideshow_published", "publish_to_site"].indexOf(name) < 0) {
      delete attempt[name];
      continue;
    }
    if (insErr?.code === "23505" && /slug/i.test(msg)) {
      attempt = { ...attempt, slideshow_slug: newSlideshowSlug() };
      continue;
    }
    throw new Error(`demo listing: ${msg}`);
  }
  throw new Error("demo listing: too many retries");
}

// ─── photos ─────────────────────────────────────────────────────────────────

const PHOTO_COPY_KEYS = ["filename", "category", "category_source", "display_order", "is_visible", "original_bytes"];

type SrcPhoto = Record<string, unknown> & { id: string; storage_path: string; storage_backend?: string | null };

export async function allRows<T>(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function copyR2Object(fromKey: string, toKey: string): Promise<void> {
  await r2().send(new CopyObjectCommand({
    Bucket: R2_PHOTO_BUCKET,
    Key: toKey,
    CopySource: `${R2_PHOTO_BUCKET}/${fromKey.split("/").map(encodeURIComponent).join("/")}`,
  }));
}

async function copySupabaseObject(svc: SupabaseClient, bucket: string, from: string, to: string): Promise<void> {
  const { error } = await svc.storage.from(bucket).copy(from, to);
  if (error && !/exist|duplicate/i.test(error.message)) throw new Error(`copy: ${error.message}`);
}

async function copyPhotos(
  svc: SupabaseClient, userId: string, listingId: string, sourceId: string, cur: SeedCursor, deadlineMs: number, log: string[]
): Promise<{ done: number; failed: number; finished: boolean; total: number }> {
  const folder = demoFolder(userId, listingId);
  const src = await allRows<SrcPhoto>((a, b) =>
    svc.from("photos").select("*").eq("listing_id", sourceId).order("display_order", { ascending: true }).order("id", { ascending: true }).range(a, b));
  const mine = await allRows<{ id: string; storage_path: string }>((a, b) =>
    svc.from("photos").select("id, storage_path").eq("listing_id", listingId).range(a, b));
  const copied = new Set<string>();
  mine.forEach((p) => {
    const rest = p.storage_path.startsWith(folder) ? p.storage_path.slice(folder.length) : "";
    const m = /^([0-9a-f-]{36})-/i.exec(rest);
    if (m) copied.add(m[1].toLowerCase());
  });
  const skip = new Set(cur.skip ?? []);
  const todo = src.filter((p) => !copied.has(p.id.toLowerCase()) && !skip.has(p.id));
  if (todo.some((p) => p.storage_backend === "r2") && !r2PhotosConfigured()) {
    throw new JobFatalError("Some source photos are on R2 but R2 isn't configured here.");
  }

  let done = 0;
  let failed = 0;
  let next = 0;
  const lane = async () => {
    while (next < todo.length) {
      if (Date.now() > deadlineMs - MARGIN_MS) return;
      const p = todo[next++];
      try {
        const dst = `${folder}${p.id}-${baseName(p.storage_path)}`;
        assertUnder(folder, dst);
        const backend = p.storage_backend === "r2" ? "r2" : "supabase";
        // File first, row second: a row never points at a missing file. A
        // crash in between re-copies (overwrites) the same key next time.
        if (backend === "r2") await copyR2Object(r2PhotoKey(p.storage_path), r2PhotoKey(dst));
        else await copySupabaseObject(svc, PHOTO_BUCKET, p.storage_path, dst);
        const row = { ...pick(p, PHOTO_COPY_KEYS), listing_id: listingId, storage_path: dst, storage_backend: backend, uploaded_by: userId };
        const { error } = await svc.from("photos").insert(row);
        if (error) throw new Error(`row: ${error.message}`);
        if (backend === "r2") noteR2PhotoExists();
        done++;
      } catch (e) {
        if (e instanceof JobFatalError) throw e;
        failed++;
        skip.add(p.id);
        if (log.length < 8) log.push(`Photo ${p.id.slice(0, 8)}… not copied: ${errText(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, Math.max(1, todo.length)) }, lane));
  cur.skip = Array.from(skip).slice(-500);
  const remaining = todo.length - done - failed;
  return { done, failed, finished: remaining <= 0, total: src.length };
}

/** Derivatives (600 / 2000) + R2 download sizes for the demo photos, through the normal code. */
async function deriveSome(svc: SupabaseClient, listingId: string, deadlineMs: number, log: string[]): Promise<{ made: number; finished: boolean }> {
  let made = 0;
  let stubborn = false;
  while (Date.now() < deadlineMs - MARGIN_MS) {
    const { data, error } = await svc.from("photos").select("id").eq("listing_id", listingId).is("derivatives_at", null).limit(12);
    if (error) throw new Error(error.message);
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) break;
    const r = await ensureDerivatives(ids, { svc, concurrency: 3, deadline: deadlineMs - MARGIN_MS });
    made += r.done.length;
    if (r.done.length + r.unavailable.length === 0) {
      if (r.failed[0] && log.length < 8) log.push(`Thumbnails: ${r.failed[0].reason.slice(0, 160)}`);
      // Nothing moved and nothing was merely out of time: only stubborn
      // photos are left — the daily derivatives backfill keeps trying them.
      if (r.deferred.length === 0) stubborn = true;
      break;
    }
  }
  // R2 originals whose Web & MLS / Social files weren't made with the
  // derivatives (sharp fallback): make them now, best effort.
  if (Date.now() < deadlineMs - MARGIN_MS) {
    const { data } = await svc.from("photos").select("id, storage_path").eq("listing_id", listingId)
      .eq("storage_backend", "r2").not("derivatives_at", "is", null).is("download_sizes", null).limit(6);
    const { storeDownloadSizes } = await import("@/lib/photoSharp");
    for (const r of (data ?? []) as { id: string; storage_path: string }[]) {
      if (Date.now() > deadlineMs - MARGIN_MS) break;
      await storeDownloadSizes(svc, r).catch(async (e) => {
        await svc.from("photos").update({ download_sizes: downloadSizesErrorRecord(r.storage_path, errText(e)) }).eq("id", r.id).then(() => {}, () => {});
      });
    }
  }
  const { count } = await svc.from("photos").select("id", { count: "exact", head: true }).eq("listing_id", listingId).is("derivatives_at", null);
  return { made, finished: (count ?? 0) === 0 || stubborn };
}

/** Cover photo + deck plan follow the copy. */
async function linkCoverAndDeckPlan(svc: SupabaseClient, userId: string, listingId: string, sourceId: string): Promise<void> {
  const folder = demoFolder(userId, listingId);
  const { data: src } = await svc.from("listings").select("*").eq("id", sourceId).maybeSingle();
  const s = (src ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (isUuid(s.hero_photo_id)) {
    const { data: hit } = await svc.from("photos").select("id").eq("listing_id", listingId).like("storage_path", `${folder}${s.hero_photo_id}-%`).maybeSingle();
    if (hit) patch.hero_photo_id = hit.id;
  }
  if (typeof s.deck_plan_path === "string" && s.deck_plan_path) {
    const dst = `${folder}deckplan-${baseName(s.deck_plan_path)}`;
    assertUnder(folder, dst);
    try {
      await copySupabaseObject(svc, PHOTO_BUCKET, s.deck_plan_path, dst);
      patch.deck_plan_path = dst;
    } catch { /* no deck plan in the demo */ }
  }
  if (Object.keys(patch).length) await svc.from("listings").update(patch).eq("id", listingId).eq("broker_id", userId);
}

// ─── videos ─────────────────────────────────────────────────────────────────

const VIDEO_COPY_KEYS = ["filename", "title", "description", "in_slideshow", "display_order", "duration_sec", "shot_cuts"];

async function copyVideos(svc: SupabaseClient, userId: string, listingId: string, sourceId: string, log: string[]): Promise<number> {
  const folder = demoFolder(userId, listingId);
  const { data: srcRows, error } = await svc.from("videos").select("*").eq("listing_id", sourceId);
  if (error) throw new Error(`videos: ${error.message}`);
  const src = ((srcRows ?? []) as (Record<string, unknown> & { id: string; storage_path: string; storage_host?: string | null; duration_sec?: number | null; thumbnail_path?: string | null })[])
    .filter((v) => v.storage_path && (v.storage_host !== "r2" || r2VideoConfigured()))
    .sort((a, b) => (Number(a.duration_sec ?? Infinity) - Number(b.duration_sec ?? Infinity)))
    .slice(0, MAX_VIDEOS);
  const { data: mine } = await svc.from("videos").select("storage_path").eq("listing_id", listingId);
  const have = new Set(((mine ?? []) as { storage_path: string }[]).map((v) => v.storage_path));
  let copied = 0;
  for (const v of src) {
    const dst = `${folder}${v.id}-${baseName(v.storage_path)}`;
    assertUnder(folder, dst);
    if (have.has(dst)) continue;
    try {
      if (v.storage_host === "r2") {
        const ext = (v.storage_path.split(".").pop() || "").toLowerCase();
        await r2VideoCopy(v.storage_path, dst, ext === "mov" ? "video/quicktime" : "video/mp4");
      } else {
        await copySupabaseObject(svc, VIDEO_BUCKET_SUPABASE, v.storage_path, dst);
      }
      let still: string | null = null;
      if (v.thumbnail_path) {
        const stillDst = `${folder}video-still-${v.id}.jpg`;
        assertUnder(folder, stillDst);
        try { await copySupabaseObject(svc, PHOTO_BUCKET, v.thumbnail_path, stillDst); still = stillDst; } catch { still = null; }
      }
      const row = { ...pick(v, VIDEO_COPY_KEYS), listing_id: listingId, storage_path: dst, storage_host: v.storage_host === "r2" ? "r2" : (v.storage_host ?? null), uploaded_by: userId, thumbnail_path: still };
      const { error: insErr } = await svc.from("videos").insert(row);
      if (insErr) throw new Error(insErr.message);
      copied++;
    } catch (e) {
      if (e instanceof JobFatalError) throw e;
      log.push(`Video ${v.id.slice(0, 8)}… not copied: ${errText(e)}`);
    }
  }
  return copied;
}

// ─── sample engagement ──────────────────────────────────────────────────────

/** Small deterministic PRNG so a re-seed after a reset looks the same. */
function prng(seedText: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seedText.length; i++) { h ^= seedText.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function seedEngagement(svc: SupabaseClient, userId: string, listingId: string, log: string[]): Promise<void> {
  const { count: existing } = await svc.from("slideshow_views").select("id", { count: "exact", head: true }).eq("listing_id", listingId);
  const { data: l } = await svc.from("listings").select("slideshow_slug, tour_url").eq("id", listingId).maybeSingle();
  const slug = (l?.slideshow_slug as string | null) ?? "demo";
  const rnd = prng(listingId);
  const now = Date.now();
  const DAY = 86_400_000;

  if ((existing ?? 0) === 0) {
    // ~40 views over the last 3 weeks from 14 visitors, varied sources.
    const sources = ["link", "link", "link", "share", "qr", "social", "send", "yp_card", "flyer"];
    const sessions = Array.from({ length: 14 }, (_, i) => `sample-${listingId.slice(0, 6)}-${i}`);
    const views: Record<string, unknown>[] = [];
    for (let i = 0; i < 40; i++) {
      const session = sessions[Math.floor(rnd() * sessions.length)];
      const at = now - Math.floor(rnd() * 21 * DAY) - Math.floor(rnd() * 3600_000);
      views.push({
        listing_id: listingId,
        slideshow_slug: slug,
        viewed_at: new Date(at).toISOString(),
        source: sources[Math.floor(rnd() * sources.length)],
        session_id: session,
        duration_s: 35 + Math.floor(rnd() * 420),
        photos_seen: 12 + Math.floor(rnd() * 110),
      });
    }
    let { error } = await svc.from("slideshow_views").insert(views);
    if (error && /source/i.test(error.message)) {
      ({ error } = await svc.from("slideshow_views").insert(views.map((v) => { const { source: _s, ...rest } = v; void _s; return rest; })));
    }
    if (error) log.push(`Sample views not added: ${error.message}`);

    // Dwell on a spread of photos, a few favourites, video plays, details, tour clicks.
    const { data: ph } = await svc.from("photos").select("id").eq("listing_id", listingId).eq("is_visible", true).order("display_order").limit(400);
    const photoIds = ((ph ?? []) as { id: string }[]).map((p) => p.id);
    const { data: vids } = await svc.from("videos").select("id").eq("listing_id", listingId);
    const videoIds = ((vids ?? []) as { id: string }[]).map((v) => v.id);
    const events: Record<string, unknown>[] = [];
    const ev = (kind: string, extra: Record<string, unknown>) => events.push({
      listing_id: listingId, slug, kind,
      session_id: sessions[Math.floor(rnd() * sessions.length)],
      created_at: new Date(now - Math.floor(rnd() * 21 * DAY)).toISOString(),
      ...extra,
    });
    if (photoIds.length) {
      const picks = Array.from({ length: Math.min(30, photoIds.length) }, (_, i) =>
        photoIds[Math.min(photoIds.length - 1, Math.floor((i * photoIds.length) / 30 + rnd() * 3))]);
      picks.forEach((pid, i) => {
        const looks = 1 + Math.floor(rnd() * (i < 6 ? 7 : 3));
        for (let k = 0; k < looks; k++) ev("dwell", { photo_id: pid, value: 3 + Math.floor(rnd() * (i < 6 ? 38 : 14)) });
      });
      for (let i = 0; i < 6; i++) ev("favorite", { photo_id: picks[Math.floor(rnd() * Math.min(10, picks.length))] });
    }
    videoIds.forEach((vid) => { for (let i = 0; i < 2; i++) ev("video_play", { video_id: vid }); });
    for (let i = 0; i < 5; i++) ev("details_view", {});
    if (l?.tour_url) for (let i = 0; i < 2; i++) ev("tour_click", {});
    for (let i = 0; i < events.length; i += 200) {
      const { error: eErr } = await svc.from("slideshow_events").insert(events.slice(i, i + 200));
      if (eErr) { log.push(`Sample engagement events not added: ${eErr.message}`); break; }
    }
    log.push(`Sample engagement added: ${views.length} views, ${events.length} events.`);
  }

  const { count: leads } = await svc.from("listing_leads").select("id", { count: "exact", head: true }).eq("listing_id", listingId);
  if ((leads ?? 0) === 0) {
    const base = { listing_id: listingId, broker_id: userId, phone: null, status: "new", source: "link" };
    const { error } = await svc.from("listing_leads").insert([
      { ...base, name: "Sample Buyer", email: "buyer@example.com", message: "Sample inquiry — is she available for a showing next week?", created_at: new Date(now - 5 * DAY).toISOString() },
      { ...base, name: "Sample Buyer", email: "buyer@example.com", message: "Sample inquiry — could you send the survey and maintenance records?", created_at: new Date(now - 2 * DAY).toISOString() },
    ]);
    if (error) log.push(`Sample inquiries not added: ${error.message}`);
  }
}

// ─── sessions ───────────────────────────────────────────────────────────────

/**
 * Sign the demo out everywhere (H2): public.demo_revoke_sessions() deletes
 * every auth session of every demo_accounts user (their refresh tokens go
 * with them). Access tokens already issued live on until they expire (≤ 1 h).
 * Logged, never fatal — a seed or reset is still worth finishing without it.
 */
export async function revokeDemoSessions(svc: SupabaseClient, log: string[], userId?: string): Promise<void> {
  try {
    // One account only when we know which (Nov 12: re-seeding the read-only
    // demo mustn't sign the filming account out mid-shoot). Falls back to
    // every demo account before migration 20261112 adds the per-user function.
    let { data, error } = userId
      ? await svc.rpc("demo_revoke_sessions_for", { p_user_id: userId })
      : await svc.rpc("demo_revoke_sessions");
    if (error && userId && /demo_revoke_sessions_for|could not find the function|does not exist/i.test(error.message)) {
      ({ data, error } = await svc.rpc("demo_revoke_sessions"));
    }
    if (error) {
      log.push(`Demo sessions NOT signed out (${error.message.slice(0, 160)}) — run select public.demo_revoke_sessions(); by hand.`);
      return;
    }
    log.push(`Demo signed out everywhere (${Number(data) || 0} session${Number(data) === 1 ? "" : "s"} ended).`);
  } catch (e) {
    log.push(`Demo sessions NOT signed out (${errText(e)}).`);
  }
}

// ─── demo_seed ──────────────────────────────────────────────────────────────

export const demoSeed: JobHandler = async (job, { svc, deadlineMs }) => {
  const cur: SeedCursor = { ...((job.cursor ?? {}) as SeedCursor) };
  const sourceId = sourceListingId(job.params ?? {});
  const log: string[] = [];
  let done = 0;
  let failed = 0;
  let total: number | undefined;

  // Identity is created / re-asserted on the FIRST batch of every run, so a
  // run always leaves email / password / metadata / MFA as they should be.
  // Later batches of the same run only re-read the id.
  let userId: string;
  if (!cur.phase || cur.phase === "identity") {
    userId = await ensureIdentity(svc, sourceId, log);
    cur.phase = "listing";
  } else {
    const account = await readAccount(svc);
    if (!account) throw new JobFatalError("The demo account disappeared mid-run — start demo_seed again.");
    userId = account.user_id;
  }
  const listingId = await ensureListing(svc, userId, sourceId, log);
  if (cur.phase === "listing") cur.phase = "photos";

  const out = (finished: boolean): StepResult => ({ cursor: cur, done, failed, total, log, finished });

  if (cur.phase === "photos") {
    const r = await copyPhotos(svc, userId, listingId, sourceId, cur, deadlineMs, log);
    done += r.done; failed += r.failed;
    if (job.total == null) total = r.total;
    log.unshift(`${r.done} photo${r.done === 1 ? "" : "s"} copied${r.failed ? `, ${r.failed} failed` : ""}.`);
    if (!r.finished) return out(false);
    await linkCoverAndDeckPlan(svc, userId, listingId, sourceId);
    cur.phase = "derive";
  }
  if (cur.phase === "derive") {
    if (Date.now() > deadlineMs - MARGIN_MS) return out(false);
    const r = await deriveSome(svc, listingId, deadlineMs, log);
    if (r.made) log.push(`${r.made} photo${r.made === 1 ? "" : "s"} got thumbnails / download sizes.`);
    if (!r.finished) return out(false);
    cur.phase = "videos";
  }
  if (cur.phase === "videos") {
    if (Date.now() > deadlineMs - 20_000) return out(false);
    const n = await copyVideos(svc, userId, listingId, sourceId, log);
    if (n) log.push(`${n} video${n === 1 ? "" : "s"} copied.`);
    cur.phase = "engagement";
  }
  if (cur.phase === "engagement") {
    await seedEngagement(svc, userId, listingId, log);
    cur.phase = "done";
  }
  await revokeDemoSessions(svc, log, userId);
  log.push("Demo ready — mint a link (see docs/where-we-are.md) and open /demo/{token}.");
  return out(true);
};

// ─── demo_reset ─────────────────────────────────────────────────────────────

async function listSupabase(svc: SupabaseClient, bucket: string, folder: string): Promise<string[]> {
  const out: string[] = [];
  for (const dir of [folder.replace(/\/$/, ""), `${folder}_d`]) {
    for (let offset = 0; offset < 20_000; offset += 1000) {
      const { data, error } = await svc.storage.from(bucket).list(dir, { limit: 1000, offset });
      if (error || !data) break;
      data.forEach((o) => { if (o.id) out.push(`${dir}/${o.name}`); });
      if (data.length < 1000) break;
    }
  }
  return out;
}

export async function listR2(bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await r2().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    (res.Contents ?? []).forEach((o) => { if (o.Key) out.push(o.Key); });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export const demoReset: JobHandler = async (_job, { svc, deadlineMs }) => {
  const log: string[] = [];
  const account = await readAccount(svc);
  if (!account) return { cursor: null, done: 0, failed: 0, total: 0, log: ["No demo account — nothing to reset."], finished: true };
  const userId = account.user_id;
  const { data: u } = await svc.auth.admin.getUserById(userId);
  if (!u?.user || !isDemoUser(u.user) || isWritableDemoUser(u.user)) throw new JobFatalError("demo_accounts user has no read-only demo claim — refusing to delete anything.");
  if (!account.listing_id) {
    log.push("The demo has no listing — nothing to reset.");
    await revokeDemoSessions(svc, log, userId);
    return { cursor: null, done: 0, failed: 0, total: 0, log, finished: true };
  }
  const listingId = account.listing_id;
  if (listingId === DEMO_SOURCE_LISTING_ID || listingId === account.source_listing_id) {
    throw new JobFatalError("demo_accounts.listing_id is the SOURCE listing — refusing.");
  }
  const { data: listing } = await svc.from("listings").select("id, broker_id, deck_plan_path").eq("id", listingId).maybeSingle();
  if (listing && listing.broker_id !== userId) throw new JobFatalError("The demo listing isn't owned by the demo user — refusing.");
  const folder = demoFolder(userId, listingId);

  if (listing) {
    // Photos: originals (both stores), derivatives, download sizes — each path checked.
    const photos = await allRows<{ id: string; storage_path: string }>((a, b) =>
      svc.from("photos").select("id, storage_path").eq("listing_id", listingId).range(a, b));
    photos.forEach((p) => {
      assertUnder(folder, p.storage_path);
      allDerivativePaths(p).forEach((d) => assertUnder(folder, d));
      (Object.keys(DOWNLOAD_SIZE_EDGES) as DownloadSizeName[]).forEach((n) => assertUnder(folder, downloadSizePath(p, n)));
    });
    for (let i = 0; i < photos.length; i += 200) {
      if (Date.now() > deadlineMs - MARGIN_MS) return { cursor: null, done: 0, failed: 0, log: ["Out of time — carrying on next batch."], finished: false };
      const chunk = photos.slice(i, i + 200);
      await deleteOriginals(svc, chunk.map((p) => p.storage_path));
      await removeDerivatives(svc, chunk);
      const { error } = await svc.from("photos").delete().in("id", chunk.map((p) => p.id)).eq("listing_id", listingId);
      if (error) throw new Error(`photos: ${error.message}`);
    }
    if (photos.length) log.push(`${photos.length} demo photos removed.`);

    const { data: vids } = await svc.from("videos").select("id, storage_path, storage_host, thumbnail_path").eq("listing_id", listingId);
    const videos = (vids ?? []) as { id: string; storage_path: string; storage_host: string | null; thumbnail_path: string | null }[];
    videos.forEach((v) => { assertUnder(folder, v.storage_path); if (v.thumbnail_path) assertUnder(folder, v.thumbnail_path); });
    for (const v of videos) {
      if (v.storage_host === "r2" && r2VideoConfigured()) await r2VideoDelete(v.storage_path).catch(() => {});
      await svc.storage.from(VIDEO_BUCKET_SUPABASE).remove([v.storage_path]).then(() => {}, () => {});
      if (v.thumbnail_path) await svc.storage.from(PHOTO_BUCKET).remove([v.thumbnail_path]).then(() => {}, () => {});
    }
    if (videos.length) {
      const { error } = await svc.from("videos").delete().in("id", videos.map((v) => v.id)).eq("listing_id", listingId);
      if (error) throw new Error(`videos: ${error.message}`);
      log.push(`${videos.length} demo videos removed.`);
    }
    if (typeof listing.deck_plan_path === "string" && listing.deck_plan_path.startsWith(folder)) {
      assertUnder(folder, listing.deck_plan_path);
      await svc.storage.from(PHOTO_BUCKET).remove([listing.deck_plan_path]).then(() => {}, () => {});
    }

    // Rows that hang off the listing (sample engagement, inquiries, reels…).
    for (const t of ["slideshow_events", "slideshow_views", "listing_leads", "client_sends", "reel_events", "listing_show_entries"]) {
      await svc.from(t).delete().eq("listing_id", listingId).then(() => {}, () => {});
    }
    const { error: lErr } = await svc.from("listings").delete().eq("id", listingId).eq("broker_id", userId);
    if (lErr) throw new Error(`listing: ${lErr.message}`);
    log.push("Demo listing removed.");
  }

  // Sweep anything left in the demo listing's own folder (e.g. a copy whose
  // row was never written). Every key is checked against the folder first.
  const leftovers: string[] = [];
  const supaPhotos = await listSupabase(svc, PHOTO_BUCKET, folder);
  supaPhotos.forEach((p) => assertUnder(folder, p));
  if (supaPhotos.length) { await svc.storage.from(PHOTO_BUCKET).remove(supaPhotos).then(() => {}, () => {}); leftovers.push(...supaPhotos); }
  const supaVideos = await listSupabase(svc, VIDEO_BUCKET_SUPABASE, folder);
  supaVideos.forEach((p) => assertUnder(folder, p));
  if (supaVideos.length) { await svc.storage.from(VIDEO_BUCKET_SUPABASE).remove(supaVideos).then(() => {}, () => {}); leftovers.push(...supaVideos); }
  if (r2PhotosConfigured()) {
    const keyPrefix = r2PhotoKey(folder);
    const keys = await listR2(R2_PHOTO_BUCKET, keyPrefix);
    for (const k of keys) {
      if (!k.startsWith(keyPrefix)) throw new JobFatalError(`R2 listed ${k} outside ${keyPrefix} — stopping.`);
      assertUnder(folder, k.slice(`photos/${PHOTO_BUCKET}/`.length));
      await r2().send(new DeleteObjectCommand({ Bucket: R2_PHOTO_BUCKET, Key: k })).catch(() => {});
    }
    leftovers.push(...keys);
  }
  if (r2VideoConfigured()) {
    const keys = await listR2(R2_VIDEO_BUCKET, folder);
    for (const k of keys) {
      assertUnder(folder, k);
      await r2VideoDelete(k).catch(() => {});
    }
    leftovers.push(...keys);
  }
  if (leftovers.length) log.push(`${leftovers.length} leftover file${leftovers.length === 1 ? "" : "s"} in the demo folder removed.`);

  await svc.from("demo_accounts").update({ listing_id: null, updated_at: new Date().toISOString() }).eq("user_id", userId);
  forgetDemoAccounts();
  await revokeDemoSessions(svc, log, userId);
  log.push("Reset done. The demo login is kept; run demo_seed to make a fresh copy.");
  return { cursor: null, done: 1, failed: 0, total: 1, log, finished: true };
};
