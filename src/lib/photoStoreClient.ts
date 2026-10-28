"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { derivativePath, hasDerivatives } from "@/lib/photoDerivativePaths";
import { PHOTO_BUCKET, normaliseBackend, originalContentType, type StorageBackend } from "@/lib/photoStoreShared";

/**
 * Photo originals from the BROWSER (Oct 28, 2026) — the counterpart of
 * src/lib/photoStore.ts. The browser can't sign R2 links itself (no keys), so
 * originals on R2 are signed by POST /api/photos/originals (access-checked);
 * originals still on Supabase are signed by the user's own client exactly as
 * before. Uploads ask POST /api/photos/upload-target where a new original
 * goes (the server-side switch) and then upload straight from the browser.
 */

type BackendRow = { storage_path: string; storage_backend?: string | null };

/** path → backend, read under the user's RLS (unknown paths → Supabase). */
async function backendsFor(supabase: SupabaseClient, paths: string[]): Promise<Map<string, StorageBackend>> {
  const out = new Map<string, StorageBackend>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  unique.forEach((p) => out.set(p, "supabase"));
  await Promise.all(
    Array.from({ length: Math.ceil(unique.length / 100) }, async (_, k) => {
      const chunk = unique.slice(k * 100, (k + 1) * 100);
      try {
        const { data, error } = await supabase.from("photos").select("storage_path, storage_backend").in("storage_path", chunk);
        if (error) return;
        ((data ?? []) as BackendRow[]).forEach((r) => {
          if (normaliseBackend(r.storage_backend) === "r2" && out.get(r.storage_path) !== undefined) out.set(r.storage_path, "r2");
        });
      } catch {
        /* Supabase */
      }
    })
  );
  return out;
}

/** Ask the server to sign R2 originals: path → url. */
async function signR2ViaServer(paths: string[], ttlSeconds: number, download = false): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 500) {
    try {
      const res = await fetch("/api/photos/originals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: paths.slice(i, i + 500), ttl: ttlSeconds, download }),
      });
      if (!res.ok) continue;
      const d = (await res.json().catch(() => null)) as { urls?: Record<string, string> } | null;
      Object.entries(d?.urls ?? {}).forEach(([p, u]) => { if (u) out.set(p, u); });
    } catch {
      /* unsigned — callers treat a missing link as a failed photo */
    }
  }
  return out;
}

/**
 * Browser drop-in for `supabase.storage.from("listing-photos").createSignedUrls(paths, ttl)`
 * on photo ORIGINALS: path → url. Supabase originals are signed by `supabase`
 * as before; R2 originals by the server.
 */
export async function signOriginalsInBrowser(
  supabase: SupabaseClient,
  paths: string[],
  ttlSeconds: number
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const backends = await backendsFor(supabase, paths);
  const supa: string[] = [];
  const r2: string[] = [];
  backends.forEach((b, p) => (b === "r2" ? r2 : supa).push(p));
  await Promise.all([
    (async () => {
      for (let i = 0; i < supa.length; i += 1000) {
        try {
          const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(supa.slice(i, i + 1000), ttlSeconds);
          (data ?? []).forEach((d) => { if (d.path && d.signedUrl && !d.error) out.set(d.path, d.signedUrl); });
        } catch {
          /* unsigned */
        }
      }
    })(),
    (async () => {
      if (r2.length === 0) return;
      const m = await signR2ViaServer(r2, ttlSeconds);
      m.forEach((u, p) => out.set(p, u));
    })(),
  ]);
  return out;
}

/** One original, signed in the browser (see signOriginalsInBrowser). */
export async function signOriginalInBrowser(supabase: SupabaseClient, path: string, ttlSeconds: number): Promise<string | null> {
  return (await signOriginalsInBrowser(supabase, [path], ttlSeconds)).get(path) ?? null;
}

/**
 * A link good for drawing a photo at `longEdge` px (reels, showroom). Supabase
 * originals: Supabase's resize, then the original if that fails — as before.
 * R2 originals: the stored 2000 px copy when the frame needs no more than
 * that, otherwise (or with no copy yet) the original.
 */
export async function photoDrawUrls(
  supabase: SupabaseClient,
  photo: { id: string; storage_path: string; derivatives_at?: string | null; storage_backend?: string | null },
  longEdge: number,
  transform: { quality: number }
): Promise<string[]> {
  let backend: StorageBackend | null = photo.storage_backend === undefined ? null : normaliseBackend(photo.storage_backend);
  if (backend === null) backend = (await backendsFor(supabase, [photo.storage_path])).get(photo.storage_path) ?? "supabase";
  const edge = Math.round(longEdge);
  if (backend === "r2") {
    const urls: string[] = [];
    if (edge <= 2000 && hasDerivatives(photo)) {
      try {
        const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(derivativePath(photo, 2000), 3600);
        if (data?.signedUrl) urls.push(data.signedUrl);
      } catch { /* original below */ }
    }
    const orig = (await signR2ViaServer([photo.storage_path], 3600)).get(photo.storage_path);
    if (orig) urls.push(orig);
    return urls;
  }
  const urls: string[] = [];
  try {
    const { data: t } = await supabase.storage.from(PHOTO_BUCKET)
      .createSignedUrl(photo.storage_path, 3600, { transform: { width: edge, height: edge, resize: "contain", quality: transform.quality } });
    if (t?.signedUrl) urls.push(t.signedUrl);
  } catch { /* original below */ }
  try {
    const { data: o } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(photo.storage_path, 3600);
    if (o?.signedUrl) urls.push(o.signedUrl);
  } catch { /* none */ }
  return urls;
}

// ─── uploads ────────────────────────────────────────────────────────────────

export type UploadScope = { listingId: string; galleryId?: undefined } | { galleryId: string; listingId?: undefined };

export type UploadedOriginal = { ok: true; backend: StorageBackend; bytes: number } | { ok: false; error: string };

/**
 * Upload one photo original straight from the browser to wherever new
 * originals go right now (the server decides: R2 or Supabase). The caller
 * then inserts the photos row with `storage_backend: result.backend` and
 * `original_bytes: result.bytes`.
 */
export async function uploadOriginal(opts: {
  supabase: SupabaseClient;
  path: string;
  file: File;
  scope: UploadScope;
  /** Passed to the Supabase upload as before (some callers set it, some don't). */
  contentType?: string;
}): Promise<UploadedOriginal> {
  const { supabase, path, file, scope } = opts;
  const multipart = file.size > MULTIPART_THRESHOLD_BYTES;
  let target: {
    backend?: string; url?: string; contentType?: string;
    multipart?: boolean; uploadId?: string; partSize?: number; partUrls?: string[];
  } | null = null;
  // Why an R2-bound upload ended up on Supabase — reported to the server log.
  let fallback: { step: string; status?: number; message?: string; attempts?: number } | null = null;
  try {
    const res = await fetch("/api/photos/upload-target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...scope, path, contentType: file.type || "", size: file.size,
        ...(multipart ? { action: "multipart_start" } : {}),
      }),
    });
    if (res.ok) target = await res.json().catch(() => null);
    else if (res.status === 401 || res.status === 403) {
      const d = await res.json().catch(() => null);
      return { ok: false, error: d?.error ?? "You don't have access to upload here." };
    } else {
      const d = await res.json().catch(() => null);
      fallback = { step: "target", status: res.status, message: d?.error ?? res.statusText };
    }
  } catch (e) {
    target = null;
    fallback = { step: "target", message: e instanceof Error ? e.message : String(e) };
  }

  if (target?.backend === "r2" && target.multipart && target.uploadId && Array.isArray(target.partUrls)) {
    const r = await uploadInParts(path, file, scope, target.uploadId, target.partSize ?? 8 * 1024 * 1024, target.partUrls);
    if (r.ok) return { ok: true, backend: "r2", bytes: file.size };
    fallback = { step: r.step, status: r.status, message: r.message, attempts: r.attempts };
  } else if (target?.backend === "r2" && target.url) {
    // One automatic retry (same signed link — a PUT to the same key is safe
    // to repeat) before falling back to Supabase.
    let lastStatus: number | undefined;
    let lastMessage = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const put = await fetch(target.url, {
          method: "PUT",
          headers: { "Content-Type": target.contentType || file.type || originalContentType(path) },
          body: file,
        });
        if (put.ok) return { ok: true, backend: "r2", bytes: file.size };
        lastStatus = put.status;
        lastMessage = (await put.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300) || put.statusText;
      } catch (e) {
        // CORS / network / preview host: the browser gives no status.
        lastStatus = undefined;
        lastMessage = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
      if (attempt === 1) await new Promise((r) => setTimeout(r, 800));
    }
    fallback = { step: "put", status: lastStatus, message: lastMessage, attempts: 2 };
    // The R2 PUT didn't work: the upload must never fail outright, so it goes
    // to Supabase exactly as before Oct 28 (the row then says "supabase").
  }

  if (fallback) {
    fetch("/api/photos/upload-fallback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...scope, path, size: file.size, type: file.type || "", ...fallback }),
      keepalive: true,
    }).catch(() => {});
  }

  // Supabase — exactly the call the pages made before Oct 28. (Also the
  // fallback if the server couldn't be asked.)
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { upsert: false, ...(opts.contentType ? { contentType: opts.contentType } : {}) });
  if (error) return { ok: false, error: error.message };
  return { ok: true, backend: "supabase", bytes: file.size };
}

/** Originals above this go up in parts (matches MULTIPART_THRESHOLD on the server). */
const MULTIPART_THRESHOLD_BYTES = 10 * 1024 * 1024;
/** Parts of ONE file in flight at once. */
const PART_CONCURRENCY = 3;
/** Tries per part (first + retries) before the whole upload gives up. */
const PART_TRIES = 4;

/**
 * Upload one big original to R2 as a multipart upload: File.slice() pieces
 * (only the piece in flight is read), PART_CONCURRENCY at a time, each part
 * retried with back-off (1 s, 2 s, 4 s). Then the server completes it and
 * checks the byte count. Any final failure aborts the multipart upload (no
 * invisible half-uploads left in R2) and reports why.
 */
async function uploadInParts(
  path: string,
  file: File,
  scope: UploadScope,
  uploadId: string,
  partSize: number,
  partUrls: string[]
): Promise<{ ok: true } | { ok: false; step: string; status?: number; message: string; attempts?: number }> {
  const etags: (string | null)[] = partUrls.map(() => null);
  let failure: { status?: number; message: string; attempts: number; part: number } | null = null;
  let next = 0;
  const lane = async () => {
    while (next < partUrls.length && !failure) {
      const i = next++;
      const piece = file.slice(i * partSize, Math.min((i + 1) * partSize, file.size));
      let status: number | undefined;
      let message = "";
      for (let attempt = 1; attempt <= PART_TRIES; attempt++) {
        try {
          const res = await fetch(partUrls[i], { method: "PUT", body: piece });
          if (res.ok) {
            const etag = res.headers.get("ETag");
            if (!etag) {
              failure = { message: "R2 didn't return the part's ETag (bucket CORS must expose ETag).", attempts: attempt, part: i + 1 };
              return;
            }
            etags[i] = etag;
            break;
          }
          status = res.status;
          message = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300) || res.statusText;
        } catch (e) {
          status = undefined;
          message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        }
        if (attempt === PART_TRIES) {
          failure = { status, message, attempts: attempt, part: i + 1 };
          return;
        }
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, partUrls.length) }, lane));

  const abort = () =>
    fetch("/api/photos/upload-target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...scope, path, uploadId, action: "multipart_abort" }),
      keepalive: true,
    }).catch(() => {});

  if (failure || etags.some((e) => !e)) {
    await abort();
    const f = failure as { status?: number; message: string; attempts: number; part: number } | null;
    return { ok: false, step: `part${f ? ` ${f.part}/${partUrls.length}` : ""}`, status: f?.status, message: f?.message ?? "a part didn't upload", attempts: f?.attempts };
  }
  try {
    const res = await fetch("/api/photos/upload-target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...scope, path, uploadId, size: file.size, action: "multipart_complete",
        parts: etags.map((ETag, i) => ({ PartNumber: i + 1, ETag })),
      }),
    });
    if (res.ok) return { ok: true };
    const d = await res.json().catch(() => null);
    await abort();
    return { ok: false, step: "complete", status: res.status, message: d?.error ?? res.statusText };
  } catch (e) {
    await abort();
    return { ok: false, step: "complete", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Undo an upload whose photos row couldn't be written (no orphan left
 * behind). Supabase: the user's own remove, as before. R2: the server removes
 * it, and only if no photos row points at the path.
 */
export async function discardUploadedOriginal(
  supabase: SupabaseClient,
  path: string,
  backend: StorageBackend,
  scope: UploadScope
): Promise<void> {
  if (backend === "supabase") {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]).then(() => {}, () => {});
    return;
  }
  await fetch("/api/photos/upload-target", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...scope, path, action: "discard" }),
  }).then(() => {}, () => {});
}

/**
 * Photos whose originals were just uploaded to R2: make their 600 px tile now
 * (callers don't hold the upload queue for it — the tile appears when it
 * lands) and queue the rest (2000 copy,
 * Web / Social files) as a background job on the server. Returns id → tile
 * link for the photos whose 600 was made. Supabase uploads keep the
 * fire-and-forget requestDerivatives. Best effort: the background job and the
 * daily backfill catch anything missed.
 */
export async function makeDerivativesNow(scope: UploadScope, photoIds: string[]): Promise<Record<string, string>> {
  const thumbs: Record<string, string> = {};
  if (photoIds.length === 0) return thumbs;
  try {
    if (scope.listingId) {
      for (let i = 0; i < photoIds.length; i += 40) {
        const res = await fetch(`/api/listings/${scope.listingId}/photos/derivatives`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoIds: photoIds.slice(i, i + 40), quick: true }),
          // Survives a page change mid-upload, so the job still gets queued.
          keepalive: true,
        });
        const d = res.ok ? await res.json().catch(() => null) : null;
        Object.assign(thumbs, (d?.thumbs ?? {}) as Record<string, string>);
      }
    } else if (scope.galleryId) {
      await fetch(`/api/admin/galleries/${scope.galleryId}/photos/derivatives`, { method: "POST" });
    }
  } catch {
    /* the background job / daily backfill catches it */
  }
  return thumbs;
}
