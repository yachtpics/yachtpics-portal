import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { logShowcaseEvent } from "@/lib/showcaseEvents";
import { orderPhotos } from "@/lib/photoOrder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Signed photo URLs for a boat on Recently Photographed. Only serves photos for
// listings that are actually featured (in_showcase, not vetoed, active), so a
// signed-in broker can't enumerate arbitrary listings' photos.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: listing } = await service
    .from("listings")
    .select("id, in_showcase, showcase_opt_out, status, hero_photo_id, photo_order_manual")
    .eq("id", params.id)
    .maybeSingle();

  if (!listing || !listing.in_showcase || listing.showcase_opt_out || listing.status !== "active") {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  // Record that this broker/assistant opened the boat's photos (admins skipped;
  // throttled per user+boat so scrolling back and forth doesn't inflate it).
  await logShowcaseEvent({ userId: user.id, kind: "boat_view", listingId: params.id, throttleMinutes: 30 });

  const { data: photoRows } = await service
    .from("photos")
    .select("id, storage_path, category, display_order")
    .eq("listing_id", params.id)
    .eq("is_visible", true)
    .order("display_order", { ascending: true });

  // Same ordering everything else uses: canonical walk-the-boat order
  // (profiles → tower → flybridge → …) by default, or the broker's hand-sorted
  // order if they arranged this listing. Hero photo always opens.
  const rows = orderPhotos(photoRows ?? [], {
    manual: listing.photo_order_manual === true,
    heroId: listing.hero_photo_id,
  });

  const paths = rows.map((r) => r.storage_path as string);
  if (paths.length === 0) return NextResponse.json({ photos: [] });

  const { data: signed } = await service.storage.from("listing-photos").createSignedUrls(paths, 3600);
  const photos = (signed ?? []).map((s) => s.signedUrl).filter(Boolean);

  return NextResponse.json({ photos });
}
