import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * GET /api/thumb/[photoId]?w=400
 *   → 302 to a resized, signed image URL.
 *
 * WHY THIS EXISTS: the listing grids were rendering full-size originals as small
 * thumbnails. Photos average ~2 MB, so a 200-photo listing pulled ~420 MB just
 * to draw a grid — slow for the broker, and a large egress bill for us.
 *
 * Supabase can resize on the fly, but only when signing ONE url at a time
 * (`createSignedUrls` has no transform option). Signing 200 individually at page
 * render would be slower than the problem. So thumbnails point here instead, and
 * because the grid lazy-loads, only the ones actually scrolled into view are
 * ever generated.
 *
 * Full-size originals are still used for the lightbox and for downloads — this
 * is only for display thumbnails.
 */

const ALLOWED_WIDTHS = [200, 400, 800];

export async function GET(req: NextRequest, { params }: { params: { photoId: string } }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const requested = Number(req.nextUrl.searchParams.get("w") ?? 400);
  // Clamp to a small set so we don't mint a different transform per pixel width —
  // each distinct size is a separately billed transformation and a separate
  // cache entry.
  const width = ALLOWED_WIDTHS.includes(requested) ? requested : 400;

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: photo } = await service
    .from("photos")
    .select("storage_path, listing_id, gallery_id")
    .eq("id", params.photoId)
    .maybeSingle();
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Access: the listing's broker, a linked assistant, an admin, or — for gallery
  // photos — someone the gallery was shared with.
  let allowed = false;

  const { data: me } = await service
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role === "admin") allowed = true;

  if (!allowed && photo.listing_id) {
    const { data: listing } = await service
      .from("listings")
      .select("broker_id")
      .eq("id", photo.listing_id)
      .maybeSingle();
    if (listing?.broker_id === user.id) {
      allowed = true;
    } else if (listing?.broker_id) {
      const { data: link } = await service
        .from("broker_assistants")
        .select("broker_id")
        .eq("broker_id", listing.broker_id)
        .eq("assistant_id", user.id)
        .maybeSingle();
      if (link) allowed = true;
      if (!allowed) {
        const { data: co } = await service
          .from("listing_co_brokers")
          .select("broker_id")
          .eq("listing_id", photo.listing_id)
          .eq("broker_id", user.id)
          .maybeSingle();
        if (co) allowed = true;
      }
    }
  }

  if (!allowed && photo.gallery_id) {
    const { data: access } = await service
      .from("gallery_access")
      .select("id")
      .eq("gallery_id", photo.gallery_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (access) allowed = true;
  }

  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: signed, error } = await service.storage
    .from("listing-photos")
    .createSignedUrl(photo.storage_path, 60 * 60 * 6, {
      transform: { width, height: width, resize: "contain", quality: 72 },
    });

  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: "Could not sign thumbnail" }, { status: 500 });
  }

  // Cache the redirect well short of the signed URL's own lifetime, so a cached
  // redirect never points at an expired target.
  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "private, max-age=1800" },
  });
}
