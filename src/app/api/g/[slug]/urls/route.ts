import { NextRequest, NextResponse } from "next/server";
import { getGalleryBySlug, loadGalleryMedia } from "@/lib/publicGallery";
import { serviceClient } from "@/lib/publicSlideshow";
import { rateLimited } from "@/lib/simpleRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/g/[slug]/urls
 *   → { photos: { [photoId]: { thumb, full } }, videos: { [videoId]: { url, posterUrl } } }
 *
 * Fresh DISPLAY links for an open public gallery whose links are about to
 * lapse (two hours) — the slideshow re-asks when a tab returns after a long
 * absence or an image fails on old links. Downloads don't use this; they
 * re-sign originals through /api/g/[slug]/signed-urls, which also checks the
 * download window.
 *
 * Public, same rule as the page: the gallery must be published (an expired
 * gallery stays viewable). Display sizes only, never originals. More than 10
 * calls a minute for one slug gets a 429.
 */
export async function POST(_req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = (params.slug ?? "").slice(0, 120);
  if (!slug) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (rateLimited(`g-urls:${slug}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  try {
    const gallery = await getGalleryBySlug(slug);
    if (!gallery || !gallery.slideshow_published) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { urls } = await loadGalleryMedia(serviceClient(), gallery.id);
    return NextResponse.json(urls, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't refresh links" }, { status: 500 });
  }
}
