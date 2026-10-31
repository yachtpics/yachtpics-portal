import type { SupabaseClient } from "@supabase/supabase-js";
import { signDerivatives } from "@/lib/photoDerivatives";
import { signResizedPaths } from "@/lib/photoStore";
import type { DerivativeSize } from "@/lib/photoDerivativePaths";

/**
 * In Review reels — server-side photo signing (admin routes only; `svc` is the
 * service-role client).
 *
 * The listingReelSource pattern: the stored derivatives (600 px tiles, 2000 px
 * slides) are signed in ONE createSignedUrls call per 1,000 photos; only photos
 * without derivatives fall back to a per-photo transform (Supabase originals)
 * — an R2 original without copies yet simply gets no link (never the
 * full-size original).
 */
export type SignablePhoto = {
  id: string;
  storage_path: string;
  derivatives_at?: string | null;
  thumb_at?: string | null;
  storage_backend?: string | null;
};

export async function signReviewPhotos(
  svc: SupabaseClient,
  photos: SignablePhoto[],
  size: DerivativeSize,
  ttlSeconds: number,
): Promise<Record<string, string>> {
  if (photos.length === 0) return {};
  const { urls, missing } = await signDerivatives(svc, photos, size, ttlSeconds);
  if (missing.length > 0) {
    const byPath: Record<string, string> = {};
    missing.forEach((p) => { byPath[p.storage_path] = p.id; });
    const signed = await signResizedPaths(
      svc,
      missing.map((p) => p.storage_path),
      ttlSeconds,
      { width: size, height: size, resize: "contain", quality: size === 600 ? 70 : 82 },
      { concurrency: 12 },
    );
    signed.forEach((url, path) => { const id = byPath[path]; if (id) urls[id] = url; });
  }
  return urls;
}

/** True when the error says the table isn't there yet (migration not run). */
export function missingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|could not find the table/i.test(err.message ?? "");
}
