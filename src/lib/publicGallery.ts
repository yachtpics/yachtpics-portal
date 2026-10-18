import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/publicSlideshow";
import { withVideoPosters, withVideoUrls } from "@/lib/videoUrls";
import { signPhotoSizes, type PhotoSizes } from "@/lib/publicPhotoUrls";

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

export type GalleryUrls = {
  photos: Record<string, PhotoSizes>;
  videos: Record<string, { url: string | null; posterUrl: string | null }>;
};

export type GalleryPhotoRow = { id: string; storage_path: string; category: string | null; display_order: number | null };
export type GalleryVideoRow = {
  id: string;
  storage_path: string;
  storage_host: string | null;
  filename: string | null;
  thumbnail_path: string | null;
};

/** Visible photos (display order) + videos, with display-size links. */
export async function loadGalleryMedia(supabase: SupabaseClient, galleryId: string): Promise<{
  photos: GalleryPhotoRow[];
  videos: GalleryVideoRow[];
  urls: GalleryUrls;
}> {
  const [{ data: photos }, { data: videos }] = await Promise.all([
    supabase
      .from("photos")
      .select("id, storage_path, category, display_order")
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
  const photoRows = (photos ?? []) as GalleryPhotoRow[];
  const videoRows = (videos ?? []) as GalleryVideoRow[];

  const [sizes, videoUrls, videoPosters] = await Promise.all([
    signPhotoSizes(supabase, photoRows.map((p) => p.storage_path), GALLERY_TTL),
    withVideoUrls(supabase, videoRows, { expiresIn: GALLERY_TTL }),
    withVideoPosters(supabase, videoRows, { expiresIn: GALLERY_TTL }),
  ]);

  const urls: GalleryUrls = { photos: {}, videos: {} };
  for (const p of photoRows) urls.photos[p.id] = sizes.get(p.storage_path) ?? { thumb: null, full: null };
  videoUrls.forEach((v, i) => {
    urls.videos[v.id] = { url: v.url, posterUrl: videoPosters[i]?.posterUrl ?? null };
  });
  return { photos: photoRows, videos: videoRows, urls };
}
