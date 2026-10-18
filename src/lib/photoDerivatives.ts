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
 */

const BUCKET = "listing-photos";
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

  const rows: { id: string; storage_path: string; derivatives_at: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await svc
      .from("photos")
      .select("id, storage_path, derivatives_at")
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

  const processOne = async (r: DerivativeSource) => {
    for (const size of DERIVATIVE_SIZES) {
      const got = await fetchResized(svc, r.storage_path, size);
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
export async function signDerivatives<T extends DerivativeSource & { derivatives_at?: string | null }>(
  supabase: SupabaseClient,
  photos: T[],
  size: DerivativeSize,
  ttlSeconds: number
): Promise<{ urls: Record<string, string>; missing: T[] }> {
  const urls: Record<string, string> = {};
  const missing: T[] = [];
  const ready: { photo: T; path: string }[] = [];
  for (const p of photos) {
    if (p.storage_path && hasDerivatives(p)) ready.push({ photo: p, path: derivativePath(p, size) });
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

/** Remove the derivative objects of these photos (best effort). */
export async function removeDerivatives(svc: SupabaseClient, photos: DerivativeSource[]): Promise<void> {
  const paths = photos.filter((p) => p.storage_path && p.id).flatMap((p) => allDerivativePaths(p));
  for (let i = 0; i < paths.length; i += 1000) {
    await svc.storage.from(BUCKET).remove(paths.slice(i, i + 1000)).then(() => {}, () => {});
  }
}
