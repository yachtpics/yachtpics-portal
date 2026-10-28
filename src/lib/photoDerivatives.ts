import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  allDerivativePaths,
  DERIVATIVE_CONTENT_TYPE,
  DERIVATIVE_SIZES,
  DERIVATIVES_UNAVAILABLE_AT,
  derivativePath,
  hasDerivatives,
  type DerivativeSize,
  type DerivativeSource,
} from "@/lib/photoDerivativePaths";

export {
  allDerivativePaths,
  derivativePath,
  hasDerivatives,
  DERIVATIVE_SIZES,
  DERIVATIVES_UNAVAILABLE_AT,
  type DerivativeSize,
  type DerivativeSource,
};

/**
 * Pre-generated photo derivatives (Oct 18) — SERVER ONLY.
 *
 * WHY: every page load used to sign a Supabase *transform* URL per photo (one
 * network call each — slow), and the on-the-fly transforms answer 429 under
 * load (~138 failures a day). Now each size is made ONCE, stored next to the
 * original, and served with plain object links that ONE createSignedUrls call
 * signs for a whole listing. Plain objects have no transform rate limit.
 *
 * HOW (generation): Supabase's own transform does the resize — we sign a
 * 2-minute transform link for the original, fetch it with `Accept: image/webp`
 * (no `format` option → WebP), and upload the bytes to the `_d` path with the
 * service-role client (bypasses storage RLS; nothing is made public). The
 * transform honours EXIF orientation and strips it, so derivatives are already
 * upright. `sharp` isn't installed, and the transform needs no new dependency.
 *
 * Naming lives in src/lib/photoDerivativePaths.ts (browser-safe).
 * `photos.derivatives_at`: null = not generated; a real time = both sizes
 * exist; DERIVATIVES_UNAVAILABLE_AT = this original can't be resized (left on
 * the old path for good, so the backfill doesn't retry it forever).
 *
 * Oct 28 — originals on R2 (`photos.storage_backend = 'r2'`, see
 * src/lib/photoStore.ts): Supabase can only resize a file it holds, so the
 * original is staged for a moment under `_tmp/derive/` in this bucket, resized
 * by the SAME transform (identical output), and the staged copy removed
 * straight after. The derivatives themselves land in Supabase as always.
 */

const BUCKET = "listing-photos";
/** Where R2 originals are staged for a moment while Supabase resizes them. */
export const STAGING_PREFIX = "_tmp/derive/";
const QUALITY = 80;
const ONE_YEAR = "31536000";

export function serviceRoleClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type FetchResult =
  | { ok: true; bytes: ArrayBuffer }
  | { ok: false; permanent: boolean; reason: string };

/** One resized copy of `path`, as WebP bytes. Retries 429 / 5xx / network with back-off. */
async function fetchResized(svc: SupabaseClient, path: string, size: DerivativeSize): Promise<FetchResult> {
  let reason = "unknown";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(800 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400));
    const { data, error } = await svc.storage
      .from(BUCKET)
      .createSignedUrl(path, 120, { transform: { width: size, height: size, resize: "contain", quality: QUALITY } });
    if (error || !data?.signedUrl) {
      reason = error?.message ?? "no signed url";
      if (/not.?found|does not exist/i.test(reason)) return { ok: false, permanent: true, reason: "original missing" };
      continue;
    }
    // Transformations switched off → Supabase quietly signs the original.
    // Never store a full-size original under a derivative name.
    if (!data.signedUrl.includes("/render/image/")) {
      return { ok: false, permanent: false, reason: "image transformation appears disabled" };
    }
    let res: Response;
    try {
      res = await fetch(data.signedUrl, { headers: { Accept: DERIVATIVE_CONTENT_TYPE }, cache: "no-store" });
    } catch (e) {
      reason = e instanceof Error ? e.message : "network error";
      continue;
    }
    if (res.ok) {
      const type = res.headers.get("content-type") ?? "";
      if (!type.includes(DERIVATIVE_CONTENT_TYPE)) {
        return { ok: false, permanent: false, reason: `transform returned ${type || "no type"}, not WebP` };
      }
      return { ok: true, bytes: await res.arrayBuffer() };
    }
    reason = `HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) await sleep(Math.min(retryAfter, 5) * 1000);
      continue;
    }
    // 400 / 404 / 413 / 415 / 422…: Supabase can't resize this file (missing,
    // not an image it reads, over its size limits). Retrying won't help.
    return { ok: false, permanent: true, reason };
  }
  return { ok: false, permanent: false, reason };
}

async function uploadDerivative(svc: SupabaseClient, path: string, bytes: ArrayBuffer): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(700 * attempt);
    const { error } = await svc.storage.from(BUCKET).upload(path, bytes, {
      contentType: DERIVATIVE_CONTENT_TYPE,
      cacheControl: ONE_YEAR,
      upsert: true,
    });
    if (!error) return null;
    if (attempt === 2) return error.message;
  }
  return "upload failed";
}

export type EnsureResult = {
  /** Generated now. */
  done: string[];
  /** Already had them (skipped). */
  skipped: string[];
  /** Can't be resized — marked so the backfill moves on. */
  unavailable: string[];
  /** Transient failure — still null, the next run tries again. */
  failed: { id: string; reason: string }[];
  /** Not started before the deadline — still null. */
  deferred: string[];
};

/**
 * Make the 600 and 2000 copies for these photos. Idempotent (photos that
 * already have them are skipped unless `force`), `concurrency` photos at a
 * time (default 4), tolerant of 429s. Stops STARTING photos once `deadline`
 * (epoch ms) passes; anything not started is reported as deferred.
 *
 * `derivatives_at` is only set when the row still points at the same file
 * (a replace mid-generation leaves it null, so it's regenerated).
 */
export async function ensureDerivatives(
  photoIds: string[],
  opts: { svc?: SupabaseClient; concurrency?: number; deadline?: number; force?: boolean } = {}
): Promise<EnsureResult> {
  const svc = opts.svc ?? serviceRoleClient();
  const out: EnsureResult = { done: [], skipped: [], unavailable: [], failed: [], deferred: [] };
  const ids = Array.from(new Set(photoIds.filter((x) => typeof x === "string" && x)));
  if (ids.length === 0) return out;

  const rows: { id: string; storage_path: string; derivatives_at: string | null; storage_backend?: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await svc
      .from("photos")
      .select("id, storage_path, derivatives_at, storage_backend")
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
  }

  const todo = rows.filter((r) => {
    if (!r.storage_path) {
      out.failed.push({ id: r.id, reason: "no storage path" });
      return false;
    }
    if (!opts.force && r.derivatives_at) {
      out.skipped.push(r.id);
      return false;
    }
    return true;
  });

  const markUnavailable = async (r: DerivativeSource, reason: string) => {
    await svc
      .from("photos")
      .update({ derivatives_at: DERIVATIVES_UNAVAILABLE_AT })
      .eq("id", r.id)
      .eq("storage_path", r.storage_path)
      .is("derivatives_at", null);
    out.unavailable.push(r.id);
    console.warn(`photo derivatives: ${r.id} unavailable (${reason})`);
  };

  const processOne = async (r: DerivativeSource & { storage_backend?: string | null }) => {
    // R2 original → a short-lived staged copy Supabase can resize.
    let source = r.storage_path;
    let staged: string | null = null;
    if (r.storage_backend === "r2") {
      let original: { bytes: Uint8Array; contentType: string };
      try {
        // Lazy: this module is reachable from client bundles (via
        // publicPhotoUrls → photoAlt); photoStore is server-only.
        const { readOriginal } = await import("@/lib/photoStore");
        original = await readOriginal(svc, r);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/NoSuchKey|not.?found|does not exist|404/i.test(msg)) await markUnavailable(r, "original missing on R2");
        else out.failed.push({ id: r.id, reason: `read original: ${msg}` });
        return;
      }
      // sharp, in this function — no staging round trip. Derivatives first
      // (tiles need them), then the pre-made download sizes into R2.
      if (await makeWithSharp(r, original.bytes)) return;
      // sharp couldn't load or decode this file (e.g. HEIC): the old staging
      // path, for this file only.
      const ext = (r.storage_path.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      staged = `${STAGING_PREFIX}${r.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { error: stageErr } = await svc.storage.from(BUCKET).upload(staged, original.bytes, {
        contentType: original.contentType,
        upsert: true,
      });
      if (stageErr) {
        out.failed.push({ id: r.id, reason: `stage: ${stageErr.message}` });
        return;
      }
      source = staged;
    }
    try {
      await makeBoth(r, source);
      // R2 original sharp couldn't read (HEIC): its Web / Social files from
      // the same staged copy, via Supabase's transform (today's params).
      if (staged && out.done.includes(r.id)) {
        const { storeDownloadSizes } = await import("@/lib/photoSharp");
        await storeDownloadSizes(svc, r, undefined, staged).catch((e) => {
          console.warn(`download sizes (staged): ${r.id} not made (${e instanceof Error ? e.message : e})`);
        });
      }
    } finally {
      if (staged) await svc.storage.from(BUCKET).remove([staged]).then(() => {}, () => {});
    }
  };

  /** R2 original: both WebP derivatives with sharp. False = fall back to staging. */
  const makeWithSharp = async (r: DerivativeSource, bytes: Uint8Array): Promise<boolean> => {
    const { makeWebpDerivatives, storeDownloadSizes } = await import("@/lib/photoSharp");
    let made: Map<DerivativeSize, Buffer>;
    try {
      made = await makeWebpDerivatives(bytes, DERIVATIVE_SIZES);
    } catch (e) {
      console.warn(`photo derivatives: sharp couldn't make ${r.id} (${e instanceof Error ? e.message : e}) — staging instead`);
      return false;
    }
    for (const size of DERIVATIVE_SIZES) {
      const buf = made.get(size)!;
      const upErr = await uploadDerivative(svc, derivativePath(r, size), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
      if (upErr) {
        out.failed.push({ id: r.id, reason: `upload: ${upErr}` });
        return true;
      }
    }
    const { error } = await svc
      .from("photos")
      .update({ derivatives_at: new Date().toISOString() })
      .eq("id", r.id)
      .eq("storage_path", r.storage_path);
    if (error) {
      out.failed.push({ id: r.id, reason: `db: ${error.message}` });
      return true;
    }
    out.done.push(r.id);
    // Web & MLS / Social files, best effort (made on demand if this fails).
    await storeDownloadSizes(svc, r, bytes).catch((e) => {
      console.warn(`download sizes: ${r.id} not made (${e instanceof Error ? e.message : e})`);
    });
    return true;
  };

  const makeBoth = async (r: DerivativeSource, source: string) => {
    for (const size of DERIVATIVE_SIZES) {
      const got = await fetchResized(svc, source, size);
      if (!got.ok) {
        if (got.permanent) await markUnavailable(r, got.reason);
        else out.failed.push({ id: r.id, reason: got.reason });
        return;
      }
      const upErr = await uploadDerivative(svc, derivativePath(r, size), got.bytes);
      if (upErr) {
        out.failed.push({ id: r.id, reason: `upload: ${upErr}` });
        return;
      }
    }
    const { error } = await svc
      .from("photos")
      .update({ derivatives_at: new Date().toISOString() })
      .eq("id", r.id)
      .eq("storage_path", r.storage_path);
    if (error) out.failed.push({ id: r.id, reason: `db: ${error.message}` });
    else out.done.push(r.id);
  };

  let next = 0;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 12));
  const lanes = Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
    while (next < todo.length) {
      const r = todo[next++];
      if (opts.deadline && Date.now() > opts.deadline) {
        out.deferred.push(r.id);
        continue;
      }
      try {
        await processOne(r);
      } catch (e) {
        out.failed.push({ id: r.id, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  });
  await Promise.all(lanes);
  return out;
}

/**
 * Upload step for originals on R2 (Oct 28): make ONLY the 600 px copy, so the
 * tile shows at once, and stamp `thumb_at`. The 2000 copy and the Web /
 * Social files follow in the background job (`r2_photo_finish`), which sets
 * derivatives_at as usual. sharp first; a file sharp can't read (HEIC) is
 * staged and resized by Supabase. Supabase-backed photos are skipped (their
 * upload flow is unchanged). Returns id → done.
 */
export async function ensureThumb600(
  photoIds: string[],
  opts: { svc?: SupabaseClient } = {}
): Promise<{ done: string[]; failed: { id: string; reason: string }[] }> {
  const svc = opts.svc ?? serviceRoleClient();
  const out = { done: [] as string[], failed: [] as { id: string; reason: string }[] };
  const ids = Array.from(new Set(photoIds.filter((x) => typeof x === "string" && x))).slice(0, 200);
  if (ids.length === 0) return out;
  const { data, error } = await svc
    .from("photos")
    .select("id, storage_path, storage_backend, derivatives_at, thumb_at")
    .in("id", ids);
  if (error) throw new Error(error.message);
  const { readOriginal } = await import("@/lib/photoStore");
  const { makeThumb600 } = await import("@/lib/photoSharp");
  for (const r of (data ?? []) as { id: string; storage_path: string; storage_backend: string | null; derivatives_at: string | null; thumb_at: string | null }[]) {
    if (r.storage_backend !== "r2" || r.derivatives_at || r.thumb_at) {
      if (r.derivatives_at || r.thumb_at) out.done.push(r.id);
      continue;
    }
    let staged: string | null = null;
    try {
      const { bytes, contentType } = await readOriginal(svc, r);
      let webp: ArrayBuffer | null = null;
      try {
        const b = await makeThumb600(bytes);
        webp = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      } catch {
        const ext = (r.storage_path.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        staged = `${STAGING_PREFIX}${r.id}-t${Date.now().toString(36)}.${ext}`;
        const { error: stErr } = await svc.storage.from(BUCKET).upload(staged, bytes, { contentType, upsert: true });
        if (stErr) throw new Error(`stage: ${stErr.message}`);
        const got = await fetchResized(svc, staged, 600);
        if (!got.ok) throw new Error(got.reason);
        webp = got.bytes;
      }
      const upErr = await uploadDerivative(svc, derivativePath(r, 600), webp);
      if (upErr) throw new Error(`upload: ${upErr}`);
      await svc.from("photos").update({ thumb_at: new Date().toISOString() }).eq("id", r.id).eq("storage_path", r.storage_path);
      out.done.push(r.id);
    } catch (e) {
      out.failed.push({ id: r.id, reason: e instanceof Error ? e.message : String(e) });
    } finally {
      if (staged) await svc.storage.from(BUCKET).remove([staged]).then(() => {}, () => {});
    }
  }
  return out;
}

/**
 * Backfill step: the newest photos still without derivatives (newest listings
 * first), until `budgetMs` runs out. Returns how many were made and how many
 * are still waiting. Used by /api/cron/derivatives and the admin button.
 */
export async function runDerivativeBackfill(opts: {
  budgetMs: number;
  batch?: number;
  concurrency?: number;
  svc?: SupabaseClient;
}): Promise<{ done: number; unavailable: number; failed: number; remaining: number; sampleErrors: string[] }> {
  const svc = opts.svc ?? serviceRoleClient();
  const deadline = Date.now() + opts.budgetMs;
  const batch = opts.batch ?? 60;
  let done = 0;
  let unavailable = 0;
  let failed = 0;
  const sampleErrors: string[] = [];
  // Ids that failed transiently THIS run — skipped for the rest of it, so one
  // stubborn photo can't eat the whole budget at the head of the queue.
  const failedIds = new Set<string>();

  while (Date.now() < deadline - 3000) {
    const { data, error } = await svc
      .from("photos")
      .select("id")
      .is("derivatives_at", null)
      .order("created_at", { ascending: false })
      .limit(batch + failedIds.size);
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((r) => r.id as string).filter((id) => !failedIds.has(id)).slice(0, batch);
    if (ids.length === 0) break;
    const r = await ensureDerivatives(ids, { svc, concurrency: opts.concurrency ?? 4, deadline: deadline - 8000 });
    done += r.done.length;
    unavailable += r.unavailable.length;
    failed += r.failed.length;
    r.failed.forEach((f) => {
      failedIds.add(f.id);
      if (sampleErrors.length < 5) sampleErrors.push(`${f.id}: ${f.reason}`);
    });
    if (r.deferred.length > 0) break;
  }

  const { count } = await svc.from("photos").select("id", { count: "exact", head: true }).is("derivatives_at", null);
  return { done, unavailable, failed, remaining: count ?? 0, sampleErrors };
}

/**
 * Plain (non-transform) signed links for the `size` derivatives of `photos`,
 * in ONE createSignedUrls call (chunked only past 1,000 paths). Works with the
 * service client or a signed-in user's client (then storage RLS applies, and
 * `_d` paths follow the same listing rule as the originals).
 *
 * `missing` = photos without derivatives (derivatives_at null / unavailable)
 * or whose object couldn't be signed — the caller falls back to its existing
 * transform-signing path for exactly those.
 */
export async function signDerivatives<T extends DerivativeSource & { derivatives_at?: string | null; thumb_at?: string | null }>(
  supabase: SupabaseClient,
  photos: T[],
  size: DerivativeSize,
  ttlSeconds: number
): Promise<{ urls: Record<string, string>; missing: T[] }> {
  const urls: Record<string, string> = {};
  const missing: T[] = [];
  const ready: { photo: T; path: string }[] = [];
  for (const p of photos) {
    // (thumb_at: an R2 upload whose 600 is made and whose 2000 is on its way.)
    if (p.storage_path && (hasDerivatives(p) || (size === 600 && !!p.thumb_at))) ready.push({ photo: p, path: derivativePath(p, size) });
    else missing.push(p);
  }
  if (ready.length === 0) return { urls, missing };

  const byPath = new Map<string, string>();
  for (let i = 0; i < ready.length; i += 1000) {
    const chunk = ready.slice(i, i + 1000);
    try {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(chunk.map((c) => c.path), ttlSeconds);
      (data ?? []).forEach((d) => {
        if (d.path && d.signedUrl && !d.error) byPath.set(d.path, d.signedUrl);
      });
    } catch {
      /* everything in this chunk falls back */
    }
  }
  for (const { photo, path } of ready) {
    const u = byPath.get(path);
    if (u) urls[photo.id] = u;
    else missing.push(photo);
  }
  return { urls, missing };
}

/**
 * Remove staged copies left under STAGING_PREFIX by a resize that died before
 * its own clean-up (older than `olderThanMs`, default 1 h). Touches nothing
 * outside that folder. Returns how many were removed.
 */
export async function sweepStagedOriginals(svc: SupabaseClient, olderThanMs = 60 * 60 * 1000): Promise<number> {
  const folder = STAGING_PREFIX.replace(/\/+$/, "");
  const cutoff = Date.now() - olderThanMs;
  let removed = 0;
  for (let round = 0; round < 20; round++) {
    const { data, error } = await svc.storage.from(BUCKET).list(folder, { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
    if (error || !data?.length) break;
    const stale = data
      .filter((o) => o.id && o.name && Date.parse(o.created_at ?? "") < cutoff)
      .map((o) => `${folder}/${o.name}`)
      .filter((p) => p.startsWith(STAGING_PREFIX));
    if (stale.length === 0) break;
    const { error: rmErr } = await svc.storage.from(BUCKET).remove(stale);
    if (rmErr) break;
    removed += stale.length;
    if (stale.length < data.length) break;
  }
  return removed;
}

/** Remove the derivative objects of these photos (best effort). */
export async function removeDerivatives(svc: SupabaseClient, photos: DerivativeSource[]): Promise<void> {
  const paths = photos.filter((p) => p.storage_path && p.id).flatMap((p) => allDerivativePaths(p));
  for (let i = 0; i < paths.length; i += 1000) {
    await svc.storage.from(BUCKET).remove(paths.slice(i, i + 1000)).then(() => {}, () => {});
  }
  // …and the pre-made Web / Social files of originals on R2 (Oct 28).
  const { deleteDownloadSizeFiles } = await import("@/lib/photoStore");
  await deleteDownloadSizeFiles(photos).catch(() => {});
}
