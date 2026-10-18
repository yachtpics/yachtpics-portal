import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Right-sized photo links for the public pages (buyer slideshow /s, gallery /g,
 * download page /d, client gallery /client).
 *
 * Those pages used to hand the browser the full-size original for every image
 * — a 70px filmstrip square included. A 60-photo boat opened on a phone at the
 * dock pulled ~130 MB. Supabase's image transformation resizes on its CDN, so
 * we sign two sizes per photo instead:
 *
 *   thumb — filmstrip squares and grid tiles (600px box, quality 72)
 *   full  — the main slide (2000px box, quality 82; Supabase caps at 2500)
 *
 * Originals are still signed, but ONLY where a page actually downloads files.
 *
 * Supabase only accepts a transform when signing one URL at a time — one
 * network round trip per photo per size. So a page render signs only what
 * first paint needs (≤ ~13–24 calls, in parallel); the slideshow/gallery
 * viewers fetch the rest in chunks via their /urls routes (signIdsAtSize,
 * 20 at a time). Supabase also rate-limits the image *render* (~200 at once),
 * which is why every tile using these is lazy-loaded and retries.
 */

export type ImageTransform = {
  width: number;
  height: number;
  resize: "contain" | "cover" | "fill";
  quality: number;
};

export const THUMB_TRANSFORM: ImageTransform = { width: 600, height: 600, resize: "contain", quality: 72 };
export const FULL_TRANSFORM: ImageTransform = { width: 2000, height: 2000, resize: "contain", quality: 82 };
/** Link-preview card (Open Graph / iMessage / WhatsApp): 1200×630 is the shape they all crop to. */
export const OG_TRANSFORM: ImageTransform = { width: 1200, height: 630, resize: "cover", quality: 80 };

export type PhotoSizes = { thumb: string | null; full: string | null };

const BUCKET = "listing-photos";

/**
 * Resized links for the FIRST `limit` paths only (default 24); path → url.
 * Used by /d and /client for their grid tiles — paths past the limit get no
 * entry, and those pages fall back to the original for that tile (their
 * pre-Oct-18 behaviour). Signing every photo here, one Supabase call each,
 * made big listings take seconds to render.
 */
export async function signTransformed(
  supabase: SupabaseClient,
  paths: string[],
  transform: ImageTransform,
  ttlSeconds: number,
  limit = 24
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean))).slice(0, limit);
  await Promise.all(
    unique.map(async (path) => {
      try {
        const { data } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(path, ttlSeconds, { transform });
        if (data?.signedUrl) out.set(path, data.signedUrl);
      } catch {
        /* leave it unsigned — the page falls back to the original */
      }
    })
  );
  return out;
}

/** Sign one path with a transform (e.g. the hero for a link preview). */
export async function signOneTransformed(
  supabase: SupabaseClient,
  path: string,
  transform: ImageTransform,
  ttlSeconds: number
): Promise<string | null> {
  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttlSeconds, { transform });
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

export type PhotoSize = "thumb" | "full";

/**
 * Sign `items` (id + path) at ONE size with at most `concurrency` signing
 * calls in flight. Returns id → url. Used for the first-paint handful on the
 * server and for the viewer's on-demand chunks (≤ 60 ids) in the /urls routes.
 *
 * Never sign a whole listing with this on a page render: each call is a
 * network round trip to Supabase, and a 257-photo boat × 2 sizes took the
 * buyer slideshow from 0.5 s to 15 s (Oct 18).
 */
export async function signIdsAtSize(
  supabase: SupabaseClient,
  items: { id: string; storage_path: string }[],
  size: PhotoSize,
  ttlSeconds: number,
  concurrency = 20
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const transform = size === "full" ? FULL_TRANSFORM : THUMB_TRANSFORM;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        const { data } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(item.storage_path, ttlSeconds, { transform });
        if (data?.signedUrl) out[item.id] = data.signedUrl;
      } catch {
        /* leave it unsigned; the viewer asks again later */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

/** Alt text for a photo on a public page: "Salon — Sea Dream". */
export function photoAlt(category: string | null | undefined, vesselName: string | null | undefined): string {
  const what = (category ?? "").trim() || "Photo";
  const name = (vesselName ?? "").trim();
  return name ? `${what} — ${name}` : what;
}
