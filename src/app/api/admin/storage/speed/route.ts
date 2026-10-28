import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { orderPhotos } from "@/lib/photoOrder";
import { signPhotosAtSize } from "@/lib/publicPhotoUrls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/storage/speed                 → { listings: [{ id, name, photos }] } (recent, for the picker)
 * GET /api/admin/storage/speed?listingId=…     → { photos: [{ id, backend }], slideFull, signMs }
 *
 * Inputs for the Speed check on Admin → Storage: which photos to time, and
 * the slideshow's opening slide link (the same 2000 px link the buyer
 * slideshow sends with its HTML). The timing itself happens in the browser.
 * Admin only; reads only — nothing is written.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const svc = auth.admin;
  const listingId = req.nextUrl.searchParams.get("listingId");

  if (!listingId) {
    const { data: ls } = await svc
      .from("listings")
      .select("id, vessel_name, make, model, created_at")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(40);
    return NextResponse.json({
      listings: (ls ?? []).map((l) => ({
        id: l.id as string,
        name: (l.vessel_name as string | null) || [l.make, l.model].filter(Boolean).join(" ") || "Untitled",
      })),
    });
  }

  const { data: listing } = await svc
    .from("listings")
    .select("id, hero_photo_id, photo_order_manual")
    .eq("id", listingId)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  const { data: rows } = await svc
    .from("photos")
    .select("id, storage_path, storage_backend, derivatives_at, category, display_order")
    .eq("listing_id", listingId)
    .eq("is_visible", true)
    .order("display_order");
  const ordered = orderPhotos((rows ?? []) as { id: string; storage_path: string; storage_backend: string | null; derivatives_at: string | null; category: string | null; display_order: number | null }[], {
    manual: listing.photo_order_manual === true,
    heroId: listing.hero_photo_id as string | null,
  });
  const first = ordered.slice(0, 1);
  const t0 = Date.now();
  const full = first.length ? await signPhotosAtSize(svc, first, "full", 600) : {};
  const signMs = Date.now() - t0;
  const counts = { supabase: 0, r2: 0 };
  ordered.forEach((p) => { counts[p.storage_backend === "r2" ? "r2" : "supabase"]++; });
  return NextResponse.json({
    photos: ordered.slice(0, 5).map((p) => ({ id: p.id, backend: p.storage_backend === "r2" ? "r2" : "supabase" })),
    counts,
    slideFull: first[0] ? full[first[0].id] ?? null : null,
    signMs,
  });
}
