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
 * Supabase only accepts a transform when signing one URL at a time, so this is
 * one call per photo per size — run in parallel, in waves, like /api/thumbs.
 * Signing is cheap; it's the image *render* that Supabase rate-limits (~200 at
 * once), which is why every tile using these is lazy-loaded and retries.
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
// Sign calls per wave. A 227-photo listing × 2 sizes is ~5 waves.
const WAVE = 100;

/** Sign each path with one transform. Returns path → url (missing paths are left out). */
export async function signTransformed(
  supabase: SupabaseClient,
  paths: string[],
  transform: ImageTransform,
  ttlSeconds: number
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  for (let i = 0; i < unique.length; i += WAVE) {
    await Promise.all(
      unique.slice(i, i + WAVE).map(async (path) => {
        try {
          const { data } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(path, ttlSeconds, { transform });
          if (data?.signedUrl) out.set(path, data.signedUrl);
        } catch {
          /* leave it unsigned rather than failing the page */
        }
      })
    );
  }
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

/**
 * Thumb + full for every path, signed together. Keyed by storage path.
 *
 * Interleaved so the two sizes share waves rather than running one after the other.
 */
export async function signPhotoSizes(
  supabase: SupabaseClient,
  paths: string[],
  ttlSeconds: number
): Promise<Map<string, PhotoSizes>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  const jobs: { path: string; kind: "thumb" | "full" }[] = [];
  for (const path of unique) {
    jobs.push({ path, kind: "full" }, { path, kind: "thumb" });
  }
  const out = new Map<string, PhotoSizes>();
  for (const path of unique) out.set(path, { thumb: null, full: null });
  for (let i = 0; i < jobs.length; i += WAVE) {
    await Promise.all(
      jobs.slice(i, i + WAVE).map(async ({ path, kind }) => {
        try {
          const { data } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(path, ttlSeconds, {
              transform: kind === "full" ? FULL_TRANSFORM : THUMB_TRANSFORM,
            });
          if (data?.signedUrl) out.get(path)![kind] = data.signedUrl;
        } catch {
          /* leave it unsigned */
        }
      })
    );
  }
  return out;
}

/** Alt text for a photo on a public page: "Salon — Sea Dream". */
export function photoAlt(category: string | null | undefined, vesselName: string | null | undefined): string {
  const what = (category ?? "").trim() || "Photo";
  const name = (vesselName ?? "").trim();
  return name ? `${what} — ${name}` : what;
}
