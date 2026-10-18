import { NextRequest, NextResponse } from "next/server";
import {
  canViewSlideshow,
  getPublishedSlideshow,
  serviceClient,
  signSlideshowExtras,
  slideshowRows,
  SLIDESHOW_TTL,
} from "@/lib/publicSlideshow";
import { signPhotosAtSize } from "@/lib/publicPhotoUrls";
import { rateLimited } from "@/lib/simpleRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_IDS = 60;

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

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(`s-urls:${slug}:${ip}`, 60, 60_000)) {
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
    const listing = await getPublishedSlideshow(slug);
    if (!listing || !(await canViewSlideshow(listing))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const supabase = serviceClient();
    const rows = await slideshowRows(listing);

    if (ids) {
      const wanted = new Set(ids);
      const items = rows.photos.filter((p) => wanted.has(p.id));
      const signed = await signPhotosAtSize(supabase, items, size, SLIDESHOW_TTL);
      const photos: Record<string, { thumb?: string; full?: string }> = {};
      for (const [id, url] of Object.entries(signed)) photos[id] = size === "full" ? { full: url } : { thumb: url };
      return NextResponse.json({ photos }, { headers: { "Cache-Control": "no-store" } });
    }

    const extras = await signSlideshowExtras(supabase, listing, rows.videos);
    return NextResponse.json({ photos: {}, ...extras }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't refresh links" }, { status: 500 });
  }
}
