/**
 * Naming for pre-generated photo derivatives — the ONE place that decides
 * where a resized copy lives and whether a photo has them. Safe to import in
 * the browser (no secrets, no server deps); the generation and server-side
 * signing live in src/lib/photoDerivatives.ts.
 *
 * Layout (same private bucket as the originals, `listing-photos`):
 *
 *   {brokerId}/{listingId}/{file}                          ← original
 *   {brokerId}/{listingId}/_d/{photoId}-{v}-600.webp       ← tiles / grid / filmstrip
 *   {brokerId}/{listingId}/_d/{photoId}-{v}-2000.webp      ← slide / lightbox
 *
 * Keeping `{listingId}` as path segment 2 matters: storage RLS reads it with
 * public.storage_listing_id(name), so a derivative is readable by exactly the
 * people who can read the original — no new policies, nothing public. Gallery
 * photos (`galleries/{galleryId}/{file}`) get `galleries/{galleryId}/_d/…` and,
 * like their originals, are only reachable through server-signed links.
 *
 * `{v}` is a short hash of the original's storage_path. Replacing a photo
 * always gives it a new storage_path (see replaceListingPhoto), so the new
 * derivatives land at a NEW key — a CDN or browser can never keep showing the
 * old picture from a year-long cache.
 *
 * Format: WebP. Supabase's image transform emits WebP when asked with
 * `Accept: image/webp` and no `format` option (checked Oct 18: a 600px tile
 * ~20–35 KB, a 2000px slide ~90–170 KB). Generation refuses to store anything
 * that comes back as another type, so the extension never lies.
 */

export const DERIVATIVE_SIZES = [600, 2000] as const;
export type DerivativeSize = (typeof DERIVATIVE_SIZES)[number];

export const DERIVATIVE_EXT = "webp";
export const DERIVATIVE_CONTENT_TYPE = "image/webp";
export const DERIVATIVE_FOLDER = "_d";

/**
 * `derivatives_at` value meaning "tried, and this original can't be resized"
 * (file missing from storage, not an image Supabase can read, too large).
 * Keeps the backfill from retrying it forever; the photo is treated exactly
 * like one without derivatives (the old transform/original path).
 */
export const DERIVATIVES_UNAVAILABLE_AT = "1970-01-01T00:00:00.000Z";

export type DerivativeSource = { id: string; storage_path: string };

/** FNV-1a, 32-bit, base36 — tiny, sync, same result in Node and the browser. */
function pathVersion(storagePath: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < storagePath.length; i++) {
    h ^= storagePath.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Where the `size` copy of this photo lives (whether or not it exists yet). */
export function derivativePath(photo: DerivativeSource, size: DerivativeSize): string {
  const path = photo.storage_path;
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  return `${dir}${DERIVATIVE_FOLDER}/${photo.id}-${pathVersion(path)}-${size}.${DERIVATIVE_EXT}`;
}

/** Both derivative paths of a photo (for deleting them). */
export function allDerivativePaths(photo: DerivativeSource): string[] {
  return DERIVATIVE_SIZES.map((s) => derivativePath(photo, s));
}

/** True when the photo's derivatives were generated (not null, not the "unavailable" marker). */
export function hasDerivatives(photo: { derivatives_at?: string | null }): boolean {
  if (!photo.derivatives_at) return false;
  const t = Date.parse(photo.derivatives_at);
  return Number.isFinite(t) && t > Date.UTC(2000, 0, 1);
}
