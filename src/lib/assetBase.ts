/**
 * Where the portal's large static assets are served from.
 * -------------------------------------------------------
 * The Walkthrough depth model + its WebAssembly runtime (~41 MB) and the reel
 * music sample packs (~5 MB) used to ship inside every Vercel deployment from
 * `public/`. They now live in the PUBLIC Supabase Storage bucket
 * `portal-assets`, at the same relative paths (`depth/v1/...`, `music/...`),
 * uploaded by `node scripts/upload-public-assets.mjs`.
 *
 * `NEXT_PUBLIC_ASSETS_BASE` points at that bucket's public root, e.g.
 *
 *   https://<project>.supabase.co/storage/v1/object/public/portal-assets/
 *
 * (the upload script prints the exact value). When it is NOT set, every path
 * resolves to the same-origin `/public` copy, exactly as before — so local dev
 * and any deployment without the variable keep working.
 *
 * Supabase serves public objects with `Access-Control-Allow-Origin: *`, and
 * the portal does not turn on cross-origin isolation (no COOP/COEP), so the
 * browser can fetch them from the page or a worker.
 *
 * Client-safe: NEXT_PUBLIC_* is inlined at build time, so changing the value
 * in Vercel needs a redeploy.
 */

const RAW_BASE = (process.env.NEXT_PUBLIC_ASSETS_BASE || "").trim();

/** The remote base, always ending in exactly one "/" — or "" when unset. */
const ASSETS_BASE = RAW_BASE ? RAW_BASE.replace(/\/+$/, "") + "/" : "";

/** True when the large assets are served from the remote bucket. */
export const remoteAssets = ASSETS_BASE !== "";

/**
 * URL for an asset path relative to the asset root, e.g. `"music/index.json"`
 * or `"depth/v1/"`. Leading slashes on `path` are ignored. Remote base set →
 * absolute bucket URL; unset → same-origin `/path`.
 */
export function assetUrl(path: string): string {
  const p = path.replace(/^\/+/, "");
  return remoteAssets ? `${ASSETS_BASE}${p}` : `/${p}`;
}
