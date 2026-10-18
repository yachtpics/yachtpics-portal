import { NextRequest, NextResponse } from "next/server";
import { GALLERY_TTL, getGalleryBySlug, getGalleryRows, signGalleryExtras } from "@/lib/publicGallery";
import { serviceClient } from "@/lib/publicSlideshow";
import { signPhotosAtSize } from "@/lib/publicPhotoUrls";
import { rateLimited } from "@/lib/simpleRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_IDS = 60;

/**
 * POST /api/g/[slug]/urls
 *
 *   { ids: string[≤60], size: "thumb" | "full" } → { photos: { [photoId]: { thumb } | { full } } }
 *   Progressive display links for the public gallery (the page signs only the
 *   opening photo + first dozen tiles). One size per call: ≤ 60 signings, 20
 *   at a time.
 *
 *   {} → { photos: {}, videos: { [videoId]: { url, posterUrl } } }
 *   Re-signs video/still links for a tab returning after they've gone stale.
 *
 * Downloads don't use this; they re-sign originals through
 * /api/g/[slug]/signed-urls, which also checks the download window.
 *
 * Since Oct 18 photos with stored derivatives are signed in one batch call
 * (and the page already sends them all), so this mostly serves photos not
 * backfilled yet, plus link refreshes.
 *
 * Public, same rule as the page: the gallery must be published (an expired
 * gallery stays viewable). Only this gallery's visible photos, display sizes
 * only. 60 calls/min per slug per client address (in-memory).
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = (params.slug ?? "").slice(0, 120);
  if (!slug) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(`g-urls:${slug}:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": "20" } });
  }

  let body: { ids?: unknown; size?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body = extras refresh */
  }
  const ids = Array.isArray(body.ids)
    ? Array.from(new Set(body.ids.filter((x): x is string => typeof x === "string" && x.length <= 64))).slice(0, MAX_IDS)
    : null;
  const size = body.size === "full" ? "full" : "thumb";

  try {
    const gallery = await getGalleryBySlug(slug);
    if (!gallery || !gallery.slideshow_published) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const supabase = serviceClient();
    const rows = await getGalleryRows(gallery.id);

    if (ids) {
      const wanted = new Set(ids);
      const items = rows.photos.filter((p) => wanted.has(p.id));
      const signed = await signPhotosAtSize(supabase, items, size, GALLERY_TTL);
      const photos: Record<string, { thumb?: string; full?: string }> = {};
      for (const [id, url] of Object.entries(signed)) photos[id] = size === "full" ? { full: url } : { thumb: url };
      return NextResponse.json({ photos }, { headers: { "Cache-Control": "no-store" } });
    }

    const { extras } = await signGalleryExtras(supabase, rows.videos);
    return NextResponse.json({ photos: {}, ...extras }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't refresh links" }, { status: 500 });
  }
}
