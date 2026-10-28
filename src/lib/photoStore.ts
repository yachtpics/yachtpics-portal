import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, R2_VIDEO_BUCKET } from "@/lib/r2";
import { derivativePath, hasDerivatives } from "@/lib/photoDerivativePaths";
import {
  PHOTO_BUCKET,
  normaliseBackend,
  originalContentType,
  originalPathInScope,
  r2PhotoKey,
  type PhotoRef,
  type StorageBackend,
} from "@/lib/photoStoreShared";

export { PHOTO_BUCKET, r2PhotoKey, originalPathInScope, type PhotoRef, type StorageBackend };

/**
 * Photo originals — the ONE server-side door to them (Oct 28, 2026).
 *
 * Every code path that signs, reads, resizes, uploads or deletes a full-size
 * photo original goes through here, so it works the same whether the file is
 * in Supabase Storage (`listing-photos`) or in Cloudflare R2 — see
 * src/lib/photoStoreShared.ts for the layout. Derivatives (600 / 2000 px WebP)
 * always stay in Supabase and are signed exactly as before.
 *
 * Which backend a path is on comes from its photos row. Callers mostly pass
 * plain storage paths (that's what they had), so the helpers look the rows up
 * themselves — through the CALLER's client, so a signed-in user's RLS still
 * decides which photos they can reach. A path with no photos row (a video
 * still, a deck plan) is a Supabase object, as it always was.
 *
 * R2 has no row-level security. An R2 original is only ever signed after its
 * row has been read (by the caller's client, or by an access-checked route)
 * AND its path sits inside that row's own listing / gallery folder
 * (originalPathInScope) — the same rule storage RLS enforced.
 */

// ─── configuration / the switch ─────────────────────────────────────────────

/** Private R2 bucket for photo originals. Defaults to the private video bucket. */
export const R2_PHOTO_BUCKET = process.env.R2_PHOTO_BUCKET || R2_VIDEO_BUCKET;

/**
 * THE SWITCH for NEW uploads — OFF by default. New originals go to Supabase,
 * exactly as before Oct 28, unless the env var PHOTO_ORIGINALS_BACKEND is
 * set to exactly "r2" (and R2 is configured). Existing photos are unaffected
 * either way — each row remembers where its own file is.
 */
export const NEW_ORIGINALS_TO_R2 = false;

/** Largest original a browser may PUT to R2 (bytes). */
export const MAX_ORIGINAL_BYTES = 100 * 1024 * 1024;

export function r2PhotosConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    R2_PHOTO_BUCKET
  );
}

/** Where a NEW original should be uploaded right now. */
export function newOriginalsBackend(): StorageBackend {
  const env = (process.env.PHOTO_ORIGINALS_BACKEND || "").trim().toLowerCase();
  const wantR2 = NEW_ORIGINALS_TO_R2 || env === "r2";
  return wantR2 && r2PhotosConfigured() ? "r2" : "supabase";
}

// ─── row lookup ─────────────────────────────────────────────────────────────

export type ResolvedPhoto = {
  storage_path: string;
  storage_backend: StorageBackend;
  id: string | null;
  derivatives_at: string | null;
  listing_id: string | null;
  gallery_id: string | null;
  /** True when a photos row was found for the path. */
  known: boolean;
};

const LOOKUP_CHUNK = 100;

// "Is there any R2 original at all?" — cached briefly so pages pay nothing
// for the lookups until the first photo actually lives on R2.
let anyR2Cache: { at: number; value: boolean } | null = null;
// Asked with the service role: a user's RLS-limited answer must never be
// cached as "there are none" for everyone else.
async function anyR2Photos(): Promise<boolean> {
  if (anyR2Cache && Date.now() - anyR2Cache.at < 5_000) return anyR2Cache.value;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return true;
  try {
    const svc = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await svc.from("photos").select("id").eq("storage_backend", "r2").limit(1);
    if (error) return true; // unknown → do the real lookups
    const value = (data ?? []).length > 0;
    anyR2Cache = { at: Date.now(), value };
    return value;
  } catch {
    return true;
  }
}

/** Forget the cached "no R2 photos yet" answer (after an upload / copy). */
export function noteR2PhotoExists(): void {
  anyR2Cache = { at: Date.now(), value: true };
}

function unknownRow(path: string): ResolvedPhoto {
  return {
    storage_path: path,
    storage_backend: "supabase",
    id: null,
    derivatives_at: null,
    listing_id: null,
    gallery_id: null,
    known: false,
  };
}

/**
 * path → its photos row (backend, id, derivatives, owner), read with `client`.
 * Paths without a row, or that the client may not read, come back as unknown
 * Supabase objects — the pre-Oct-28 behaviour.
 */
export async function lookupPhotoPaths(client: SupabaseClient, paths: string[]): Promise<Map<string, ResolvedPhoto>> {
  const out = new Map<string, ResolvedPhoto>();
  const unique = Array.from(new Set(paths.filter((p) => typeof p === "string" && p)));
  unique.forEach((p) => out.set(p, unknownRow(p)));
  if (unique.length === 0) return out;
  if (!(await anyR2Photos())) return out;
  await Promise.all(
    Array.from({ length: Math.ceil(unique.length / LOOKUP_CHUNK) }, async (_, k) => {
      const chunk = unique.slice(k * LOOKUP_CHUNK, (k + 1) * LOOKUP_CHUNK);
      try {
        const { data, error } = await client
          .from("photos")
          .select("id, storage_path, storage_backend, derivatives_at, listing_id, gallery_id")
          .in("storage_path", chunk);
        if (error) return;
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          const path = r.storage_path as string;
          const prev = out.get(path);
          const backend = normaliseBackend(r.storage_backend);
          // Two rows on one path (shouldn't happen): any Supabase row means
          // the Supabase object is the one to use.
          if (prev?.known) {
            if (backend === "supabase") prev.storage_backend = "supabase";
            continue;
          }
          out.set(path, {
            storage_path: path,
            storage_backend: backend,
            id: (r.id as string) ?? null,
            derivatives_at: (r.derivatives_at as string | null) ?? null,
            listing_id: (r.listing_id as string | null) ?? null,
            gallery_id: (r.gallery_id as string | null) ?? null,
            known: true,
          });
        }
      } catch {
        /* unknown → Supabase */
      }
    })
  );
  return out;
}

// ─── R2 primitives ──────────────────────────────────────────────────────────

/**
 * RFC 5987 Content-Disposition (same as r2.ts) — non-ASCII names otherwise
 * make the signed link 400 when clicked.
 */
function contentDisposition(filename: string, inline = false): string {
  const ascii = filename.replace(/["\\]/g, "").replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Seven days is SigV4's ceiling. */
const MAX_PRESIGN = 604800;

export async function presignR2Original(
  path: string,
  expiresIn: number,
  opts: { downloadAs?: string | null } = {}
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: R2_PHOTO_BUCKET,
    Key: r2PhotoKey(path),
    ...(opts.downloadAs ? { ResponseContentDisposition: contentDisposition(opts.downloadAs) } : {}),
  });
  return getSignedUrl(r2(), cmd, { expiresIn: Math.max(60, Math.min(Math.round(expiresIn), MAX_PRESIGN)) });
}

/**
 * A presigned PUT for one original (browser direct upload). Signs the content
 * type and the exact length, so the browser can only send a file of the size
 * it declared (and the caller caps that size).
 */
export async function presignR2OriginalPut(
  path: string,
  contentType: string,
  contentLength: number,
  expiresIn = 60 * 60
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: R2_PHOTO_BUCKET,
    Key: r2PhotoKey(path),
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(r2(), cmd, { expiresIn, signableHeaders: new Set(["content-type", "content-length"]) });
}

/** Delete ONE R2 original key (only the R2 copy — never Supabase). */
export async function deleteR2Original(path: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: R2_PHOTO_BUCKET, Key: r2PhotoKey(path) }));
}

/** Size + type of an R2 original, or null if it isn't there. */
export async function headR2Original(
  path: string
): Promise<{ size: number; contentType: string | null; lastModified: Date | null } | null> {
  try {
    const res = await r2().send(new HeadObjectCommand({ Bucket: R2_PHOTO_BUCKET, Key: r2PhotoKey(path) }));
    return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? null, lastModified: res.LastModified ?? null };
  } catch {
    return null;
  }
}

export async function putR2Original(path: string, body: Uint8Array, contentType: string): Promise<void> {
  await r2().send(new PutObjectCommand({
    Bucket: R2_PHOTO_BUCKET,
    Key: r2PhotoKey(path),
    Body: body,
    ContentType: contentType,
  }));
}

/**
 * Server-side copy of an R2 original to another bucket/key (the public
 * website bucket). The bytes never pass through the function.
 */
export async function copyR2OriginalTo(path: string, destBucket: string, destKey: string, contentType?: string): Promise<void> {
  await r2().send(new CopyObjectCommand({
    Bucket: destBucket,
    Key: destKey,
    CopySource: `${R2_PHOTO_BUCKET}/${r2PhotoKey(path).split("/").map(encodeURIComponent).join("/")}`,
    ...(contentType ? { MetadataDirective: "REPLACE", ContentType: contentType } : {}),
  }));
}

// ─── signing ────────────────────────────────────────────────────────────────

export type SignedEntry = { path: string; signedUrl: string; error: string | null };

export type SignOriginalOpts = {
  /**
   * Content-Disposition: attachment. `true` = Supabase's default name /
   * the key's own name on R2; a string = that file name; a function picks a
   * name per path (null = no disposition).
   */
  download?: boolean | string | ((path: string) => string | null);
};

function downloadNameFor(opts: SignOriginalOpts, path: string): string | null {
  const d = opts.download;
  if (!d) return null;
  if (typeof d === "function") return d(path);
  if (typeof d === "string") return d;
  return path.split("/").pop() || "photo";
}

/**
 * Drop-in for `client.storage.from("listing-photos").createSignedUrls(paths, ttl)`:
 * one entry per input path, in order, `{ path, signedUrl, error }`. Supabase
 * paths are signed by `client` exactly as before (RLS applies to a user's
 * client); R2 paths are presigned locally after the scope check.
 */
export async function signOriginalPaths(
  client: SupabaseClient,
  paths: string[],
  ttlSeconds: number,
  opts: SignOriginalOpts = {}
): Promise<SignedEntry[]> {
  const list = paths.map((p) => (typeof p === "string" ? p : ""));
  if (list.length === 0) return [];
  const rows = await lookupPhotoPaths(client, list);
  const supa: string[] = [];
  const r2Rows: ResolvedPhoto[] = [];
  rows.forEach((r) => (r.storage_backend === "r2" ? r2Rows.push(r) : supa.push(r.storage_path)));

  const byPath = new Map<string, { url: string | null; error: string | null }>();

  // Supabase — one batch call per download name (createSignedUrls takes one).
  if (supa.length > 0) {
    const groups = new Map<string, string[]>();
    for (const p of supa) {
      const name = typeof opts.download === "function" ? opts.download(p) : null;
      const key = typeof opts.download === "function" ? name ?? "" : "";
      const g = groups.get(key) ?? [];
      g.push(p);
      groups.set(key, g);
    }
    await Promise.all(
      Array.from(groups.entries()).map(async ([name, group]) => {
        const download =
          typeof opts.download === "function" ? (name ? name : undefined) : opts.download ? opts.download : undefined;
        for (let i = 0; i < group.length; i += 1000) {
          const chunk = group.slice(i, i + 1000);
          try {
            const { data, error } = await client.storage
              .from(PHOTO_BUCKET)
              .createSignedUrls(chunk, ttlSeconds, download !== undefined ? { download } : undefined);
            if (error) chunk.forEach((p) => byPath.set(p, { url: null, error: error.message }));
            (data ?? []).forEach((d) => {
              if (d.path) byPath.set(d.path, { url: d.signedUrl || null, error: d.error ?? null });
            });
          } catch (e) {
            chunk.forEach((p) => byPath.set(p, { url: null, error: e instanceof Error ? e.message : "sign failed" }));
          }
        }
      })
    );
  }

  // R2 — local presigning, no network.
  for (const r of r2Rows) {
    if (!originalPathInScope(r.storage_path, r)) {
      byPath.set(r.storage_path, { url: null, error: "out of scope" });
      continue;
    }
    try {
      const url = await presignR2Original(r.storage_path, ttlSeconds, { downloadAs: downloadNameFor(opts, r.storage_path) });
      byPath.set(r.storage_path, { url, error: null });
    } catch (e) {
      byPath.set(r.storage_path, { url: null, error: e instanceof Error ? e.message : "sign failed" });
    }
  }

  return list.map((p) => {
    const hit = byPath.get(p);
    return { path: p, signedUrl: hit?.url ?? "", error: hit?.url ? null : hit?.error ?? "not signed" };
  });
}

/** path → signed url (only paths that signed). */
export async function signOriginalMap(
  client: SupabaseClient,
  paths: string[],
  ttlSeconds: number,
  opts: SignOriginalOpts = {}
): Promise<Map<string, string>> {
  const entries = await signOriginalPaths(client, paths, ttlSeconds, opts);
  const out = new Map<string, string>();
  entries.forEach((e) => { if (e.signedUrl) out.set(e.path, e.signedUrl); });
  return out;
}

/** One original. Drop-in for `createSignedUrl(path, ttl, { download })` (no transform). */
export async function signOriginalUrl(
  client: SupabaseClient,
  path: string,
  ttlSeconds: number,
  opts: SignOriginalOpts = {}
): Promise<string | null> {
  const [e] = await signOriginalPaths(client, [path], ttlSeconds, opts);
  return e?.signedUrl || null;
}

// ─── resized display copies ────────────────────────────────────────────────

export type Transform = {
  width?: number;
  height?: number;
  resize?: "contain" | "cover" | "fill";
  quality?: number;
  format?: "origin";
};

export type ResizedOpts = {
  download?: string | boolean;
  /**
   * R2 original without stored copies yet: make them first (service-role
   * `client` only — used by the AI labelling / description paths).
   */
  ensure?: boolean;
};

/**
 * A resized link for an R2 original. Supabase can't transform a file it
 * doesn't hold, so this uses the stored derivatives (which are in Supabase):
 * a "contain" box up to 600 → the 600 copy; any other "contain" → the 2000
 * copy; "cover"/"fill" (link-preview crops) → Supabase's transform applied to
 * the 2000 copy. No derivatives yet → null (the caller's "not ready" path);
 * a full-size original is NEVER handed out as a resized image. With
 * `ensure`, the copies are made first. `client` signs the derivative, so RLS
 * still applies.
 */
async function r2ResizedUrl(
  client: SupabaseClient,
  row: ResolvedPhoto,
  ttlSeconds: number,
  transform: Transform,
  opts: ResizedOpts = {}
): Promise<string | null> {
  if (!originalPathInScope(row.storage_path, row)) return null;
  if (row.id && !hasDerivatives(row) && opts.ensure) {
    try {
      const { ensureDerivatives } = await import("@/lib/photoDerivatives");
      const r = await ensureDerivatives([row.id], { svc: client, concurrency: 1 });
      if (r.done.includes(row.id) || r.skipped.includes(row.id)) {
        const { data } = await client.from("photos").select("derivatives_at").eq("id", row.id).maybeSingle();
        row = { ...row, derivatives_at: (data?.derivatives_at as string | null) ?? null };
      }
    } catch {
      /* not ready → null below */
    }
  }
  if (row.id && hasDerivatives(row)) {
    const ref = { id: row.id, storage_path: row.storage_path };
    const w = transform.width ?? transform.height ?? 2000;
    const h = transform.height ?? transform.width ?? 2000;
    const mode = transform.resize ?? "cover";
    try {
      if (mode === "contain") {
        const size = Math.max(w, h) <= 600 ? 600 : 2000;
        const { data } = await client.storage
          .from(PHOTO_BUCKET)
          .createSignedUrl(derivativePath(ref, size), ttlSeconds, opts.download ? { download: opts.download } : undefined);
        if (data?.signedUrl) return data.signedUrl;
      } else {
        const { data } = await client.storage
          .from(PHOTO_BUCKET)
          .createSignedUrl(derivativePath(ref, 2000), ttlSeconds, {
            transform: {
              width: Math.min(w, 2000),
              height: Math.min(h, 2000),
              resize: mode,
              ...(transform.quality ? { quality: transform.quality } : {}),
            },
            ...(opts.download ? { download: opts.download } : {}),
          });
        if (data?.signedUrl) return data.signedUrl;
      }
    } catch {
      /* not ready */
    }
  }
  return null;
}

/**
 * Drop-in for `createSignedUrl(path, ttl, { transform })` on photo originals.
 * Supabase originals: Supabase's transform, exactly as before. R2 originals:
 * the stored derivatives (see r2ResizedUrl).
 */
export async function signResizedPath(
  client: SupabaseClient,
  path: string,
  ttlSeconds: number,
  transform: Transform,
  opts: ResizedOpts = {}
): Promise<string | null> {
  const map = await signResizedPaths(client, [path], ttlSeconds, transform, { ...opts, concurrency: 1 });
  return map.get(path) ?? null;
}

/** Many paths, one transform: path → url (paths that failed are absent). */
export async function signResizedPaths(
  client: SupabaseClient,
  paths: string[],
  ttlSeconds: number,
  transform: Transform,
  opts: ResizedOpts & { concurrency?: number; rows?: Map<string, ResolvedPhoto> } = {}
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rows = opts.rows ?? (await lookupPhotoPaths(client, paths));
  const items = Array.from(new Set(paths.filter(Boolean))).map((p) => rows.get(p) ?? unknownRow(p));
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const row = items[next++];
      try {
        if (row.storage_backend === "r2") {
          const u = await r2ResizedUrl(client, row, ttlSeconds, transform, opts);
          if (u) out.set(row.storage_path, u);
        } else {
          const { data } = await client.storage.from(PHOTO_BUCKET).createSignedUrl(row.storage_path, ttlSeconds, {
            transform: transform as never,
            ...(opts.download ? { download: opts.download } : {}),
          });
          if (data?.signedUrl) out.set(row.storage_path, data.signedUrl);
        }
      } catch {
        /* left unsigned — callers already handle a missing link */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, opts.concurrency ?? 20), items.length) }, worker));
  return out;
}

// ─── bytes ──────────────────────────────────────────────────────────────────

/** The original's bytes (server side: derivative generation, website copy, migration). */
export async function readOriginal(
  svc: SupabaseClient,
  ref: { storage_path: string; storage_backend?: string | null }
): Promise<{ bytes: Uint8Array; contentType: string }> {
  let backend = ref.storage_backend === undefined || ref.storage_backend === null
    ? (await lookupPhotoPaths(svc, [ref.storage_path])).get(ref.storage_path)?.storage_backend ?? "supabase"
    : normaliseBackend(ref.storage_backend);
  if (backend === "r2") {
    const res = await r2().send(new GetObjectCommand({ Bucket: R2_PHOTO_BUCKET, Key: r2PhotoKey(ref.storage_path) }));
    if (!res.Body) throw new Error("The original is empty on R2.");
    return {
      bytes: await res.Body.transformToByteArray(),
      contentType: res.ContentType || originalContentType(ref.storage_path),
    };
  }
  backend = "supabase";
  const { data, error } = await svc.storage.from(PHOTO_BUCKET).download(ref.storage_path);
  if (error || !data) throw new Error(error?.message ?? "original missing");
  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    contentType: data.type || originalContentType(ref.storage_path),
  };
}

/**
 * A resized JPEG/PNG of an original (long edge `edge`, upright, original
 * format) as bytes — for things that can't take WebP (the dock-card PDF).
 * Supabase originals: Supabase's transform with format "origin", as before.
 * R2 originals (no image library here — sharp isn't installed): the original
 * is staged under `_tmp/derive/` for a moment, resized by the same transform,
 * and the staged copy removed. Server side only; nothing full-size leaves it.
 */
export async function resizedOriginalBytes(
  svc: SupabaseClient,
  path: string,
  edge: number,
  quality = 85
): Promise<Uint8Array | null> {
  const row = (await lookupPhotoPaths(svc, [path])).get(path);
  let source = path;
  let staged: string | null = null;
  try {
    if (row?.storage_backend === "r2") {
      if (!originalPathInScope(path, row)) return null;
      const { bytes, contentType } = await readOriginal(svc, row);
      const ext = (path.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      staged = `_tmp/derive/card-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await svc.storage.from(PHOTO_BUCKET).upload(staged, bytes, { contentType, upsert: true });
      if (error) return null;
      source = staged;
    }
    const { data } = await svc.storage.from(PHOTO_BUCKET).createSignedUrl(source, 120, {
      transform: { width: edge, height: edge, resize: "contain", quality, format: "origin" },
    });
    if (!data?.signedUrl) return null;
    const res = await fetch(data.signedUrl, { headers: { Accept: "image/jpeg,image/png;q=0.9" }, cache: "no-store" });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    if (staged) await svc.storage.from(PHOTO_BUCKET).remove([staged]).then(() => {}, () => {});
  }
}

// ─── deleting ───────────────────────────────────────────────────────────────

/**
 * Remove these photo originals wherever they are. Always tries BOTH stores:
 * a migrated photo can have its Supabase copy and its R2 copy at once (until
 * the cleanup runs), and removing a missing object is harmless on either.
 * Best effort — never throws. Derivatives are removed separately
 * (removeDerivatives), as before.
 */
export async function deleteOriginals(svc: SupabaseClient, paths: string[]): Promise<void> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return;
  for (let i = 0; i < unique.length; i += 1000) {
    await svc.storage.from(PHOTO_BUCKET).remove(unique.slice(i, i + 1000)).then(() => {}, () => {});
  }
  // Until any photo has ever lived on R2 there is nothing there to remove.
  if (!r2PhotosConfigured() || !(await anyR2Photos())) return;
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const p = unique[next++];
      await r2().send(new DeleteObjectCommand({ Bucket: R2_PHOTO_BUCKET, Key: r2PhotoKey(p) })).then(() => {}, () => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, unique.length) }, worker));
}
