import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { orderPhotos } from "@/lib/photoOrder";
import { signPhotosAtSize } from "@/lib/publicPhotoUrls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/storage/speed                 → { listings: [{ id, name, broker, photos, status }] } (40 recent active)
 * GET /api/admin/storage/speed?q=pomboo         → same shape: up to 20 listings of ANY status with photos,
 *                                                 matching vessel name / make / model or broker name
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

  const q = (req.nextUrl.searchParams.get("q") ?? "").replace(/[%,()*\\]/g, " ").trim().slice(0, 60);

  if (!listingId) {
    type L = { id: string; vessel_name: string | null; make: string | null; model: string | null; status: string | null; broker_id: string | null };
    let ls: L[] = [];
    if (q) {
      // Search across ALL listings (any status): vessel name / make / model, or broker name.
      const like = `%${q}%`;
      const { data: brokers } = await svc
        .from("profiles")
        .select("id")
        .or(`first_name.ilike.${like},last_name.ilike.${like},display_email.ilike.${like}`)
        .limit(50);
      const brokerIds = (brokers ?? []).map((b) => b.id as string);
      const filters = [`vessel_name.ilike.${like}`, `make.ilike.${like}`, `model.ilike.${like}`];
      if (brokerIds.length) filters.push(`broker_id.in.(${brokerIds.join(",")})`);
      const { data } = await svc
        .from("listings")
        .select("id, vessel_name, make, model, status, broker_id")
        .or(filters.join(","))
        .order("created_at", { ascending: false })
        .limit(60);
      ls = (data ?? []) as L[];
    } else {
      const { data } = await svc
        .from("listings")
        .select("id, vessel_name, make, model, status, broker_id")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(40);
      ls = (data ?? []) as L[];
    }
    const [counts, names] = await Promise.all([
      Promise.all(ls.map((l) =>
        svc.from("photos").select("id", { count: "exact", head: true }).eq("listing_id", l.id).then((r) => r.count ?? 0)
      )),
      (async () => {
        const ids = Array.from(new Set(ls.map((l) => l.broker_id).filter((x): x is string => !!x)));
        if (!ids.length) return new Map<string, string>();
        const { data } = await svc.from("profiles").select("id, first_name, last_name, display_email").in("id", ids);
        return new Map((data ?? []).map((p) => [
          p.id as string,
          [p.first_name, p.last_name].filter(Boolean).join(" ") || (p.display_email as string | null) || "",
        ]));
      })(),
    ]);
    const listings = ls
      .map((l, i) => ({
        id: l.id,
        name: l.vessel_name || [l.make, l.model].filter(Boolean).join(" ") || "Untitled",
        broker: (l.broker_id && names.get(l.broker_id)) || "",
        photos: counts[i],
        status: l.status,
      }))
      .filter((l) => !q || l.photos > 0)
      .slice(0, q ? 20 : 40);
    return NextResponse.json({ listings });
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
