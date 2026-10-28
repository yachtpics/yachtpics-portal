/**
 * Photo originals — where they live. Browser-safe (no secrets, no server deps);
 * the server side is src/lib/photoStore.ts, the browser side
 * src/lib/photoStoreClient.ts.
 *
 * Oct 28, 2026: full-resolution ORIGINALS can live in one of two places, per
 * photo (`photos.storage_backend`):
 *
 *   'supabase'  Supabase Storage, bucket `listing-photos`, key = storage_path
 *               (everything before Oct 28)
 *   'r2'        Cloudflare R2, private bucket (R2_PHOTO_BUCKET, defaulting to
 *               the private video bucket), key = `photos/listing-photos/{storage_path}`
 *
 * The storage_path itself never changes between the two, so derivative names
 * (src/lib/photoDerivativePaths.ts, keyed off storage_path) are identical and
 * the 600 / 2000 px derivatives stay in Supabase whichever backend holds the
 * original. Video stills and deck plans also stay in Supabase — only rows of
 * the `photos` table can be on R2.
 */

export const PHOTO_BUCKET = "listing-photos";

export type StorageBackend = "supabase" | "r2";

/** Anything that names a photo original. */
export type PhotoRef = {
  storage_path: string;
  storage_backend?: string | null;
  id?: string | null;
  derivatives_at?: string | null;
  listing_id?: string | null;
  gallery_id?: string | null;
};

export function normaliseBackend(v: unknown): StorageBackend {
  return v === "r2" ? "r2" : "supabase";
}

/** R2 object key for a photo original. */
export function r2PhotoKey(storagePath: string): string {
  return `photos/${PHOTO_BUCKET}/${storagePath.replace(/^\/+/, "")}`;
}

/**
 * Does `path` sit where a photo of this listing / gallery is allowed to live?
 * The same rule storage RLS applied to Supabase objects (listing id is path
 * segment 2; gallery photos are `galleries/{galleryId}/…`). R2 has no RLS, so
 * this check is what stops a photos row from pointing at another listing's
 * file and getting it signed.
 */
export function originalPathInScope(
  path: string,
  owner: { listing_id?: string | null; gallery_id?: string | null }
): boolean {
  if (!path || path.includes("..") || path.startsWith("/")) return false;
  const parts = path.split("/");
  if (parts.includes("_d")) return false;
  if (owner.gallery_id) return parts.length >= 3 && parts[0] === "galleries" && parts[1] === owner.gallery_id;
  if (owner.listing_id) return parts.length >= 3 && parts[0] !== "galleries" && parts[1] === owner.listing_id;
  return false;
}

/** Content type for an original, from its file name (upload + verification). */
export function originalContentType(path: string, fallback = "application/octet-stream"): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    default:
      return fallback;
  }
}
