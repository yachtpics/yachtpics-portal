import { NextRequest, NextResponse } from "next/server";
import { canViewSlideshow, getPublishedSlideshow } from "@/lib/publicSlideshow";
import { handleSlideshowUrls } from "@/lib/slideshowUrlsHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/s/[slug]/urls
 *
 *   { ids: string[≤60], size: "thumb" | "full" }
 *     → { photos: { [photoId]: { thumb } | { full } } }
 *   The viewer's progressive loader: the page only signs the opening photo and
 *   the first dozen tiles; the rest are asked for here, in chunks, as they're
 *   about to be needed (and again when old links are refreshed). ONE size per
 *   call, so a 60-id call is ≤ 60 signings, 20 at a time.
 *
 *   {} (no ids)
 *     → { photos: {}, videos: { [videoId]: { url, posterUrl } }, deckPlanUrl }
 *   Re-signs the video / still / deck-plan links when a tab returns after
 *   they've gone stale.
 *
 * Since Oct 18 photos with stored derivatives are signed in one batch call
 * (and the page already sends them all), so this mostly serves photos not
 * backfilled yet, plus link refreshes.
 *
 * Public — no login — but it applies EXACTLY the page's rules (shared code in
 * src/lib/publicSlideshow.ts): the listing must be published under this slug,
 * and the owner's plan must be live unless the caller is the owner/team/admin.
 * Only ids of this listing's visible photos are signed, at display sizes —
 * never originals. Rate limit: 60 calls/min per slug per client address
 * (in-memory, per server instance); a 257-photo listing needs ~5 tile calls.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = (params.slug ?? "").slice(0, 120);
  if (!slug) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Same rule as the page: published under this slug, and the owner's plan
  // live unless the caller is the owner/team/admin. (Shared handler:
  // src/lib/slideshowUrlsHandler.ts.)
  return handleSlideshowUrls(req, `s-urls:${slug}`, async () => {
    const listing = await getPublishedSlideshow(slug);
    return listing && (await canViewSlideshow(listing)) ? listing : null;
  });
}
