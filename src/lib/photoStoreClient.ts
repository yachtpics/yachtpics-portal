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
  let target: { backend?: string; url?: string; contentType?: string } | null = null;
  try {
    const res = await fetch("/api/photos/upload-target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...scope, path, contentType: file.type || "", size: file.size }),
    });
    if (res.ok) target = await res.json().catch(() => null);
    else if (res.status === 401 || res.status === 403) {
      const d = await res.json().catch(() => null);
      return { ok: false, error: d?.error ?? "You don't have access to upload here." };
    }
  } catch {
    target = null;
  }

  if (target?.backend === "r2" && target.url) {
    try {
      const put = await fetch(target.url, {
        method: "PUT",
        headers: { "Content-Type": target.contentType || file.type || originalContentType(path) },
        body: file,
      });
      if (put.ok) return { ok: true, backend: "r2", bytes: file.size };
    } catch {
      /* CORS / network / preview host — fall back to Supabase below */
    }
    // The R2 PUT didn't work: the upload must never fail outright, so it goes
    // to Supabase exactly as before Oct 28 (the row then says "supabase").
  }

  // Supabase — exactly the call the pages made before Oct 28. (Also the
  // fallback if the server couldn't be asked.)
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { upsert: false, ...(opts.contentType ? { contentType: opts.contentType } : {}) });
  if (error) return { ok: false, error: error.message };
  return { ok: true, backend: "supabase", bytes: file.size };
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
 * Make the stored 600 / 2000 px copies of photos whose originals were just
 * uploaded to R2 — AWAITED, so tiles, labelling and public pages never need
 * the full-size original. (Supabase uploads keep the fire-and-forget
 * requestDerivatives.) Best effort: the daily backfill catches anything missed.
 */
export async function makeDerivativesNow(scope: UploadScope, photoIds: string[]): Promise<void> {
  if (photoIds.length === 0) return;
  try {
    if (scope.listingId) {
      for (let i = 0; i < photoIds.length; i += 40) {
        await fetch(`/api/listings/${scope.listingId}/photos/derivatives`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoIds: photoIds.slice(i, i + 40) }),
        });
      }
    } else if (scope.galleryId) {
      await fetch(`/api/admin/galleries/${scope.galleryId}/photos/derivatives`, { method: "POST" });
    }
  } catch {
    /* the daily backfill catches it */
  }
}

// ─── resizing in the browser ────────────────────────────────────────────────

/**
 * Downscale an image blob so its long edge is at most `edge`, re-encoded as
 * `type` (JPEG / PNG — the original's own format). Used for the Web & MLS and
 * Social downloads of originals on R2, which Supabase can't resize. Halves
 * step by step for a clean result (one big drawImage step aliases), honours
 * EXIF orientation, never upscales.
 */
export async function resizeImageBlob(blob: Blob, edge: number, type: string, quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
  try {
    const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
    const tw = Math.max(1, Math.round(bmp.width * scale));
    const th = Math.max(1, Math.round(bmp.height * scale));
    let src: CanvasImageSource = bmp;
    let sw = bmp.width;
    let sh = bmp.height;
    while (sw / 2 >= tw && sh / 2 >= th) {
      const c = document.createElement("canvas");
      c.width = Math.round(sw / 2);
      c.height = Math.round(sh / 2);
      const ctx = c.getContext("2d");
      if (!ctx) break;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, 0, 0, c.width, c.height);
      src = c;
      sw = c.width;
      sh = c.height;
    }
    const out = document.createElement("canvas");
    out.width = tw;
    out.height = th;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("No canvas");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (type !== "image/png") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, tw, th);
    }
    ctx.drawImage(src, 0, 0, tw, th);
    const encodeAs = type === "image/png" ? "image/png" : "image/jpeg";
    return await new Promise<Blob>((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the photo."))), encodeAs, quality)
    );
  } finally {
    bmp.close();
  }
}
