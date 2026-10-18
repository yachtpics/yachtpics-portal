import { NextRequest, NextResponse } from "next/server";
import {
  canViewSlideshow,
  getPublishedSlideshow,
  loadSlideshowMedia,
  serviceClient,
} from "@/lib/publicSlideshow";
import { rateLimited } from "@/lib/simpleRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/s/[slug]/urls
 *   → { photos: { [photoId]: { thumb, full } }, videos: { [videoId]: { url, posterUrl } }, deckPlanUrl }
 *
 * Fresh signed links for an open buyer slideshow whose links are about to
 * lapse (they live two hours). Called by the viewer when a tab comes back
 * after a long absence, or when an image fails on old links.
 *
 * Public — no login — but it applies EXACTLY the page's rules (shared code in
 * src/lib/publicSlideshow.ts): the listing must be published under this slug,
 * and the owner's plan must be live unless the caller is the owner/team/admin.
 * It returns only what the page itself already hands every visitor (visible
 * photos at display sizes, slideshow videos, deck plan) — never originals.
 * Lightly rate-limited: more than 10 calls a minute for one slug gets a 429.
 */
export async function POST(_req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = (params.slug ?? "").slice(0, 120);
  if (!slug) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (rateLimited(`s-urls:${slug}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  try {
    const listing = await getPublishedSlideshow(slug);
    if (!listing || !(await canViewSlideshow(listing))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { urls } = await loadSlideshowMedia(serviceClient(), listing);
    return NextResponse.json(urls, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't refresh links" }, { status: 500 });
  }
}
