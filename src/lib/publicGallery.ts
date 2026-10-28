import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, signFirstPaint } from "@/lib/publicSlideshow";
import { withVideoUrls } from "@/lib/videoUrls";
import { signOriginalPaths } from "@/lib/photoStore";

/**
 * Shared by the public gallery page (/g/[slug]), its link preview and its
 * link-refresh route (/api/g/[slug]/urls), so all three agree on what may be
 * shown and sign media the same way.
 *
 * Rule (unchanged from the page): an unpublished gallery is fully blocked; an
 * expired one stays VIEWABLE (only downloads close — the download routes
 * enforce that separately).
 */

export const GALLERY_TTL = 7200;

export type PublicGallery = {
  id: string;
  title: string;
  slug: string;
  slideshow_published: boolean | null;
  downloads_enabled: boolean | null;
  expires_at: string | null;
  created_by: string | null;
};

/** The gallery behind a slug (published or not), or null. Cached per request. */
export const getGalleryBySlug = cache(async (slug: string): Promise<PublicGallery | null> => {
  const { data } = await serviceClient()
    .from("galleries")
    .select("id, title, slug, slideshow_published, downloads_enabled, expires_at, created_by")
    .eq("slug", slug)
    .maybeSingle();
  return (data as PublicGallery | null) ?? null;
});

export type GalleryPhotoRow = { id: string; storage_path: string; category: string | null; display_order: number | null; derivatives_at: string | null };
export type GalleryVideoRow = {
  id: string;
  storage_path: string;
  storage_host: string | null;
  filename: string | null;
  thumbnail_path: string | null;
};

export type GalleryExtras = {
  videos: Record<string, { url: string | null; posterUrl: string | null }>;
};

/** Tiles signed by transform for first paint when a gallery isn't backfilled (same as FIRST_PAINT_TILES). */
export const GALLERY_FIRST_PAINT_TILES = 12;

/** Visible photos (display order) + videos. DB only. Cached per request (page + link preview). */
export const getGalleryRows = cache(async (galleryId: string): Promise<{
  photos: GalleryPhotoRow[];
  videos: GalleryVideoRow[];
}> => {
  const supabase = serviceClient();
  const [{ data: photos }, { data: videos }] = await Promise.all([
    supabase
      .from("photos")
      .select("id, storage_path, category, display_order, derivatives_at")
      .eq("gallery_id", galleryId)
      .eq("is_visible", true)
      .order("display_order"),
    supabase
      .from("videos")
      .select("id, storage_path, storage_host, filename, created_at, thumbnail_path")
      .eq("gallery_id", galleryId)
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("created_at"),
  ]);
  return { photos: (photos ?? []) as GalleryPhotoRow[], videos: (videos ?? []) as GalleryVideoRow[] };
});

/**
 * Video links + their stills, and (only when asked — downloads open) the
 * photo originals as the download fallback. Stills and originals share ONE
 * createSignedUrls batch on listing-photos.
 */
export async function signGalleryExtras(
  supabase: SupabaseClient,
  videos: GalleryVideoRow[],
  originalsFor: GalleryPhotoRow[] = []
): Promise<{ extras: GalleryExtras; originals: Map<string, string> }> {
  const paths = [
    ...videos.map((v) => v.thumbnail_path).filter((p): p is string => !!p),
    ...originalsFor.map((p) => p.storage_path),
  ];
  const [videoUrls, batch] = await Promise.all([
    withVideoUrls(supabase, videos, { expiresIn: GALLERY_TTL }),
    paths.length > 0
      ? signOriginalPaths(supabase, paths, GALLERY_TTL) // stills stay in Supabase; originals may be on R2
      : Promise.resolve([] as { path: string | null; signedUrl: string }[]),
  ]);
  const byPath = new Map(batch.map((d) => [d.path ?? "", d.signedUrl] as const));
  const extras: GalleryExtras = { videos: {} };
  videoUrls.forEach((v) => {
    extras.videos[v.id] = { url: v.url, posterUrl: v.thumbnail_path ? byPath.get(v.thumbnail_path) ?? null : null };
  });
  const originals = new Map<string, string>();
  for (const p of originalsFor) {
    const u = byPath.get(p.storage_path);
    if (u) originals.set(p.id, u);
  }
  return { extras, originals };
}

/**
 * What the page sends with the HTML: every stored-derivative link (two batch
 * calls), plus — for photos not backfilled yet — the opening slide and first
 * dozen tiles by transform. Same rule as the buyer slideshow (signFirstPaint).
 */
export async function signGalleryFirstPaint(
  supabase: SupabaseClient,
  photos: GalleryPhotoRow[]
): Promise<Record<string, { thumb: string | null; full?: string }>> {
  const map = await signFirstPaint(supabase, photos, GALLERY_TTL);
  const out: Record<string, { thumb: string | null; full?: string }> = {};
  for (const [id, v] of Object.entries(map)) {
    out[id] = { thumb: v.thumb ?? null, ...(v.full ? { full: v.full } : {}) };
  }
  return out;
}
