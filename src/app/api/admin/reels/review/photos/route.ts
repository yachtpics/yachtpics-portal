import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { orderPhotos } from "@/lib/photoOrder";
import { signReviewPhotos } from "@/lib/reviewReelServer";
import type { ReviewPhotoOption } from "@/lib/reviewReel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reels/review/photos?listingId=…   (admin)
 *   → { photos: ReviewPhotoOption[] }
 *
 * Every visible photo of one listing, in the listing's own order, with a
 * 600 px tile each — the "Use this photo" picker on the In Review page.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const svc = auth.admin;
  const listingId = req.nextUrl.searchParams.get("listingId");
  if (!listingId || !/^[0-9a-f-]{36}$/i.test(listingId)) return NextResponse.json({ error: "Missing listingId" }, { status: 400 });

  const [{ data: l }, { data: ph, error }] = await Promise.all([
    svc.from("listings").select("hero_photo_id, photo_order_manual").eq("id", listingId).maybeSingle(),
    svc.from("photos").select("id, storage_path, category, display_order, filename, derivatives_at, thumb_at, storage_backend")
      .eq("listing_id", listingId).eq("is_visible", true).order("display_order").limit(2000),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!l) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  type P = { id: string; storage_path: string; category: string | null; display_order: number | null; filename: string | null; derivatives_at: string | null; thumb_at: string | null; storage_backend: string | null };
  const ordered = orderPhotos((ph ?? []) as P[], { manual: l.photo_order_manual === true, heroId: l.hero_photo_id });
  const thumbs = await signReviewPhotos(svc, ordered, 600, 6 * 3600);
  const photos: ReviewPhotoOption[] = ordered.map((p) => ({ id: p.id, category: p.category, thumb: thumbs[p.id] ?? null }));
  return NextResponse.json({ photos });
}
