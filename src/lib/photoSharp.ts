import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DERIVATIVE_CONTENT_TYPE,
  DOWNLOAD_SIZE_EDGES,
  DOWNLOAD_SIZE_QUALITY,
  downloadSizeExt,
  downloadSizePath,
  type DerivativeSize,
  type DownloadSizeName,
  type DownloadSizesRecord,
} from "@/lib/photoDerivativePaths";

/**
 * Server-side image work for originals on R2 (Oct 28) — SERVER ONLY.
 *
 * Supabase can only resize files it holds, so for an R2 original the stored
 * derivatives, the broker download sizes and the dock-card JPEG are made here
 * with sharp, matching what the Supabase transform produced:
 *   derivatives    long edge 600 / 2000, fit inside, no enlargement, WebP q80
 *   Web & MLS      long edge 2048, JPEG q85 (PNG stays PNG)
 *   Social         long edge 1080, JPEG q85 (PNG stays PNG)
 * EXIF orientation is applied (rotate()) and metadata stripped, as the
 * transform did. Supabase-backed photos never come through here.
 *
 * sharp is loaded lazily: if it can't load or can't decode a file (e.g. a
 * HEIC it wasn't built for), callers fall back to the old Supabase staging
 * path for that one file. Work is serialised (one image at a time per
 * instance) to keep a 30 MB original's decode within the function's memory.
 */

type Sharp = typeof import("sharp");
let sharpPromise: Promise<Sharp | null> | null = null;

export function loadSharp(): Promise<Sharp | null> {
  if (!sharpPromise) {
    sharpPromise = import("sharp")
      .then((m) => {
        const s = ((m as unknown as { default?: Sharp }).default ?? (m as unknown as Sharp)) as Sharp;
        try {
          s.cache(false);
          s.concurrency(1);
        } catch {
          /* older builds */
        }
        return s;
      })
      .catch((e) => {
        console.warn("sharp unavailable:", e instanceof Error ? e.message : e);
        return null;
      });
  }
  return sharpPromise;
}

// One image at a time per instance.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

async function pipeline(input: Uint8Array) {
  const sharp = await loadSharp();
  if (!sharp) throw new Error("sharp unavailable");
  return sharp(Buffer.from(input.buffer, input.byteOffset, input.byteLength), { failOn: "none", limitInputPixels: 268_402_689 }).rotate();
}

/** The 600 and 2000 px WebP derivatives of an original. Throws if it can't decode. */
export function makeWebpDerivatives(original: Uint8Array, sizes: readonly DerivativeSize[]): Promise<Map<DerivativeSize, Buffer>> {
  return serial(async () => {
    const base = await pipeline(original);
    const out = new Map<DerivativeSize, Buffer>();
    for (const size of sizes) {
      out.set(
        size,
        await base.clone().resize(size, size, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
      );
    }
    return out;
  });
}

/** A JPEG (or PNG for PNG originals) with long edge `edge`, quality q. */
export function makeJpegOrPng(original: Uint8Array, edge: number, png: boolean, quality = DOWNLOAD_SIZE_QUALITY): Promise<Buffer> {
  return serial(async () => {
    const p = (await pipeline(original)).resize(edge, edge, { fit: "inside", withoutEnlargement: true });
    return png ? p.png().toBuffer() : p.jpeg({ quality }).toBuffer();
  });
}

/** Both download sizes of an original. Throws if it can't decode. */
export function makeDownloadSizes(original: Uint8Array, storagePath: string): Promise<Map<DownloadSizeName, Buffer>> {
  return serial(async () => {
    const base = await pipeline(original);
    const png = downloadSizeExt(storagePath) === "png";
    const out = new Map<DownloadSizeName, Buffer>();
    for (const name of Object.keys(DOWNLOAD_SIZE_EDGES) as DownloadSizeName[]) {
      const edge = DOWNLOAD_SIZE_EDGES[name];
      const p = base.clone().resize(edge, edge, { fit: "inside", withoutEnlargement: true });
      out.set(name, png ? await p.png().toBuffer() : await p.jpeg({ quality: DOWNLOAD_SIZE_QUALITY }).toBuffer());
    }
    return out;
  });
}

export const DERIVATIVE_TYPE = DERIVATIVE_CONTENT_TYPE;

/**
 * Web / Social files via a short-lived staged Supabase copy and Supabase's
 * transform with exactly today's download params (contain, q85, format
 * "origin", asking for JPEG/PNG) — for originals sharp can't decode (HEIC).
 * `staged` = an already-staged copy to reuse (the caller removes it);
 * otherwise one is made from `original` and removed here.
 */
async function downloadSizesViaStaging(
  svc: SupabaseClient,
  photo: { id: string; storage_path: string },
  original: Uint8Array | null,
  staged: string | null
): Promise<Map<DownloadSizeName, { bytes: Uint8Array; type: string }>> {
  const BUCKET = "listing-photos";
  let source = staged;
  let ownStage: string | null = null;
  try {
    if (!source) {
      if (!original) throw new Error("no original to stage");
      const ext = (photo.storage_path.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      ownStage = `_tmp/derive/dl-${photo.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { error } = await svc.storage.from(BUCKET).upload(ownStage, original, { upsert: true });
      if (error) throw new Error(`stage: ${error.message}`);
      source = ownStage;
    }
    const out = new Map<DownloadSizeName, { bytes: Uint8Array; type: string }>();
    for (const name of Object.keys(DOWNLOAD_SIZE_EDGES) as DownloadSizeName[]) {
      const edge = DOWNLOAD_SIZE_EDGES[name];
      const { data } = await svc.storage.from(BUCKET).createSignedUrl(source, 120, {
        transform: { width: edge, height: edge, resize: "contain", quality: DOWNLOAD_SIZE_QUALITY, format: "origin" },
      });
      if (!data?.signedUrl) throw new Error("couldn't sign the staged copy");
      const res = await fetch(data.signedUrl, { headers: { Accept: "image/jpeg,image/png;q=0.9" }, cache: "no-store" });
      if (!res.ok) throw new Error(`staged resize HTTP ${res.status}`);
      const type = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      out.set(name, { bytes: new Uint8Array(await res.arrayBuffer()), type });
    }
    return out;
  } finally {
    if (ownStage) await svc.storage.from(BUCKET).remove([ownStage]).then(() => {}, () => {});
  }
}

/**
 * Make and store both download sizes of an R2 original in R2 (`_dl/` beside
 * the original), and record them on the photos row (`download_sizes`, only if
 * the row still points at the same original). sharp first; if it can't decode
 * the file (HEIC), the staged Supabase transform. `original` may be passed
 * when the caller already has the bytes; `staged` when a staged copy exists.
 * Throws only if both ways fail.
 */
export async function storeDownloadSizes(
  svc: SupabaseClient,
  photo: { id: string; storage_path: string },
  original?: Uint8Array,
  staged?: string | null
): Promise<DownloadSizesRecord | null> {
  const { putR2Original, readOriginal } = await import("@/lib/photoStore");
  let bytes = original ?? null;
  if (!bytes && !staged) bytes = (await readOriginal(svc, { storage_path: photo.storage_path, storage_backend: "r2" })).bytes;
  const sharpType = downloadSizeExt(photo.storage_path) === "png" ? "image/png" : "image/jpeg";
  let files: Map<DownloadSizeName, { bytes: Uint8Array; type: string }>;
  try {
    if (!bytes) throw new Error("staged only");
    const made = await makeDownloadSizes(bytes, photo.storage_path);
    files = new Map(Array.from(made.entries()).map(([k, b]) => [k, { bytes: new Uint8Array(b), type: sharpType }]));
  } catch {
    files = await downloadSizesViaStaging(svc, photo, bytes, staged ?? null);
  }
  const rec: DownloadSizesRecord = { path: photo.storage_path };
  for (const [name, f] of Array.from(files.entries())) {
    await putR2Original(downloadSizePath(photo, name), f.bytes, f.type);
    rec[name] = f.bytes.byteLength;
  }
  await svc
    .from("photos")
    .update({ download_sizes: rec })
    .eq("id", photo.id)
    .eq("storage_path", photo.storage_path)
    .then(() => {}, () => {});
  return rec;
}

/** Make the 600 px WebP only (the upload step's tile). Throws if sharp can't decode. */
export async function makeThumb600(original: Uint8Array): Promise<Buffer> {
  const m = await makeWebpDerivatives(original, [600]);
  return m.get(600)!;
}
