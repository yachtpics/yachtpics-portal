import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { orderPhotos } from "@/lib/photoOrder";
import { signReviewPhotos } from "@/lib/reviewReelServer";
import {
  etMidnightUtc, isTestBroker, isYmd, nextDay, pickProfilePhoto, type ReviewBoat,
} from "@/lib/reviewReel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ListingRow = {
  id: string; broker_id: string; vessel_name: string | null; year: number | null; make: string | null; model: string | null;
  length_ft: string | number | null; photographed_at: string | null; created_at: string; hero_photo_id: string | null;
  photo_order_manual: boolean | null; showcase_opt_out: boolean | null; sold_at: string | null;
};
type PhotoRow = {
  id: string; listing_id: string; storage_path: string; category: string | null; display_order: number | null;
  filename: string | null; derivatives_at: string | null; thumb_at: string | null; storage_backend: string | null;
};
type BrokerRow = { id: string; first_name: string | null; last_name: string | null; display_email: string | null };

/**
 * GET /api/admin/reels/review?from=YYYY-MM-DD&to=YYYY-MM-DD   (admin)
 *   → { boats: ReviewBoat[], noProfile: ReviewBoat[], excluded: { pocket, test, noPhotos, noProfile } }
 *
 * The boats YachtPics shot in the period (Eastern dates, `to` inclusive):
 * photographed_at in range, or — with no photographed_at — created_at in
 * range. Pocket listings (showcase_opt_out) and test brokers are left out;
 * sold boats stay in. Each boat comes with its profile photo
 * (pickProfilePhoto: cover, else first Profiles photo) and a 600 px tile for
 * it. Boats with neither come back separately in `noProfile` (photo id "") —
 * not in the reel unless a photo is chosen by hand. Oldest first.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const svc = auth.admin;

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!isYmd(from) || !isYmd(to) || from > to) {
    return NextResponse.json({ error: "Pick a start and end date (start on or before end)." }, { status: 400 });
  }
  const fromIso = etMidnightUtc(from);
  const toIso = etMidnightUtc(nextDay(to));

  const cols = "id, broker_id, vessel_name, year, make, model, length_ft, photographed_at, created_at, hero_photo_id, photo_order_manual, showcase_opt_out, sold_at";
  // Two plain queries rather than one OR across two columns: easier to read
  // and each uses its own index.
  const [shot, guessed] = await Promise.all([
    svc.from("listings").select(cols).gte("photographed_at", fromIso).lt("photographed_at", toIso).limit(5000),
    svc.from("listings").select(cols).is("photographed_at", null).gte("created_at", fromIso).lt("created_at", toIso).limit(5000),
  ]);
  if (shot.error || guessed.error) {
    return NextResponse.json({ error: (shot.error ?? guessed.error)?.message ?? "Couldn’t read the listings." }, { status: 500 });
  }
  const all = ((shot.data ?? []) as ListingRow[]).concat((guessed.data ?? []) as ListingRow[]);

  const brokerIds = Array.from(new Set(all.map((l) => l.broker_id)));
  const brokers: Record<string, BrokerRow> = {};
  for (let i = 0; i < brokerIds.length; i += 200) {
    const { data } = await svc.from("profiles").select("id, first_name, last_name, display_email").in("id", brokerIds.slice(i, i + 200));
    ((data ?? []) as BrokerRow[]).forEach((b) => { brokers[b.id] = b; });
  }

  let pocket = 0, test = 0, noPhotos = 0;
  const listings = all.filter((l) => {
    if (l.showcase_opt_out) { pocket++; return false; }
    const b = brokers[l.broker_id];
    if (b && isTestBroker(b)) { test++; return false; }
    return true;
  });

  // Visible photos for those listings, a page at a time (a year is ~20k rows).
  const photosBy: Record<string, PhotoRow[]> = {};
  const ids = listings.map((l) => l.id);
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    for (let page = 0; ; page++) {
      const { data, error } = await svc.from("photos")
        .select("id, listing_id, storage_path, category, display_order, filename, derivatives_at, thumb_at, storage_backend")
        .in("listing_id", chunk).eq("is_visible", true)
        .order("id").range(page * 1000, page * 1000 + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const rows = (data ?? []) as PhotoRow[];
      rows.forEach((p) => { (photosBy[p.listing_id] = photosBy[p.listing_id] ?? []).push(p); });
      if (rows.length < 1000) break;
    }
  }

  const picked: { l: ListingRow; photo: PhotoRow | null; count: number }[] = [];
  listings.forEach((l) => {
    const ordered = orderPhotos(photosBy[l.id] ?? [], { manual: l.photo_order_manual === true, heroId: l.hero_photo_id });
    if (ordered.length === 0) { noPhotos++; return; }
    picked.push({ l, photo: pickProfilePhoto(ordered, l.hero_photo_id), count: ordered.length });
  });

  const thumbs = await signReviewPhotos(svc, picked.map((x) => x.photo).filter((p): p is PhotoRow => !!p), 600, 6 * 3600);

  const withPhotos: ReviewBoat[] = picked.map(({ l, photo, count }) => {
    const b = brokers[l.broker_id];
    const len = l.length_ft ? `${Math.round(Number(l.length_ft))}′` : "";
    const mm = [l.make, l.model].filter(Boolean).join(" ");
    return {
      listingId: l.id,
      name: l.vessel_name?.trim() || [l.year, l.make, l.model].filter(Boolean).join(" ") || "Untitled",
      spec: [l.year ? String(l.year) : "", [len, mm].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
      brokerName: b ? ([b.first_name, b.last_name].filter(Boolean).join(" ") || b.display_email || "") : "",
      shotAt: l.photographed_at ?? l.created_at,
      shotDateGuessed: !l.photographed_at,
      sold: !!l.sold_at,
      photoCount: count,
      photo: photo ? { id: photo.id, category: photo.category, thumb: thumbs[photo.id] ?? null } : { id: "", category: null, thumb: null },
    };
  }).sort((a, b) => (Date.parse(a.shotAt) || 0) - (Date.parse(b.shotAt) || 0) || a.name.localeCompare(b.name));

  const boats = withPhotos.filter((b) => !!b.photo.id);
  const noProfile = withPhotos.filter((b) => !b.photo.id);
  return NextResponse.json({ boats, noProfile, excluded: { pocket, test, noPhotos, noProfile: noProfile.length } });
}
