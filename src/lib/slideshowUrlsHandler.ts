import { NextRequest, NextResponse } from "next/server";
import {
  serviceClient,
  signSlideshowExtras,
  slideshowRows,
  SLIDESHOW_TTL,
  type SlideshowListing,
} from "@/lib/publicSlideshow";
import { signPhotosAtSize } from "@/lib/publicPhotoUrls";
import { rateLimited } from "@/lib/simpleRateLimit";

const MAX_IDS = 60;

/**
 * The buyer viewer's link-refresh handler, shared by /api/s/[slug]/urls and
 * the YachtPics share link's /api/yp/[token]/urls (Nov 1). Each route
 * supplies its own `resolve` — the page's exact "may this be shown?" rule —
 * and a rate-limit key; everything else (ids ≤ 60 of this listing's visible
 * photos, display sizes only, extras refresh on an empty body) is identical.
 * See /api/s/[slug]/urls for the full contract.
 */
export async function handleSlideshowUrls(
  req: NextRequest,
  rateKey: string,
  resolve: () => Promise<SlideshowListing | null>
): Promise<NextResponse> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(`${rateKey}:${ip}`, 60, 60_000)) {
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
    const listing = await resolve();
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
