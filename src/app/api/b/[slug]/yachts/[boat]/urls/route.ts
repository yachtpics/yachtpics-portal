import { NextRequest, NextResponse } from "next/server";
import { serviceClient, signSlideshowExtras, slideshowRows, SLIDESHOW_TTL } from "@/lib/publicSlideshow";
import { signPhotosAtSize } from "@/lib/publicPhotoUrls";
import { rateLimited } from "@/lib/simpleRateLimit";
import { siteBoatListingById } from "@/lib/brokerSiteServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_IDS = 60;

/**
 * POST /api/b/[slug]/yachts/[boat]/urls — the boat page's progressive photo
 * links, same contract as /api/s/[slug]/urls ({ids, size} → photos;
 * {} → videos + deck plan), but with the SITE's rules: the site must be live
 * (published + websiteEntitlement) and the boat must pass the site rule
 * (siteBoatListingById — [boat] is the listing id). Only this listing's visible photos, display
 * sizes only, never originals. Same rate limit (60/min per site+boat per address).
 * /s and its route are untouched.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string; boat: string } }) {
  const slug = (params.slug ?? "").slice(0, 60);
  const boatKey = (params.boat ?? "").slice(0, 80);
  if (!slug || !boatKey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(`b-urls:${slug}:${boatKey}:${ip}`, 60, 60_000)) {
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
    // `boat` is the listing id here (the page passes it), so this check stays light.
    const listing = await siteBoatListingById(slug, boatKey);
    if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
