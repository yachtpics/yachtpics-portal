import { cache } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { hasAccess } from "@/lib/subscriptionAccess";
import { orderPhotos } from "@/lib/photoOrder";
import { withVideoUrls } from "@/lib/videoUrls";
import { signPhotosAtSize, type PhotoSize } from "@/lib/publicPhotoUrls";

/**
 * Shared by the buyer slideshow page (/s/[slug]), its link preview
 * (generateMetadata) and its link-refresh route (/api/s/[slug]/urls), so all
 * three apply exactly the same "may this be shown?" rules and sign media the
 * same way.
 */

/** How long the page's links live. The viewer re-signs before they lapse. */
export const SLIDESHOW_TTL = 7200;

const LISTING_COLUMNS =
  "id, vessel_name, vessel_type, year, length_ft, make, model, asking_price, location, broker_id, description, beam_ft, draft_ft, staterooms, heads, engines, engine_hours, fuel_type, cruising_speed_kn, max_speed_kn, hull_material, hero_photo_id, photo_order_manual, tour_url, deck_plan_path";

export type SlideshowListing = {
  id: string;
  vessel_name: string | null;
  vessel_type: string | null;
  year: number | null;
  length_ft: number | null;
  make: string | null;
  model: string | null;
  asking_price: number | null;
  location: string | null;
  broker_id: string;
  description: string | null;
  beam_ft: number | null;
  draft_ft: number | null;
  staterooms: number | null;
  heads: number | null;
  engines: string | null;
  engine_hours: number | null;
  fuel_type: string | null;
  cruising_speed_kn: number | null;
  max_speed_kn: number | null;
  hull_material: string | null;
  hero_photo_id: string | null;
  photo_order_manual: boolean | null;
  tour_url: string | null;
  deck_plan_path: string | null;
};

export function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** The published listing behind a slug, or null. Cached per request (page + metadata share it). */
export const getPublishedSlideshow = cache(async (slug: string): Promise<SlideshowListing | null> => {
  const { data } = await serviceClient()
    .from("listings")
    .select(LISTING_COLUMNS)
    .eq("slideshow_slug", slug)
    .eq("slideshow_published", true)
    .maybeSingle();
  return (data as SlideshowListing | null) ?? null;
});

/** Is the owning broker's plan live (or office-covered)? Cached per request. */
export const ownerHasAccess = cache(async (brokerId: string): Promise<boolean> => {
  const { status } = await getEffectiveAccessStatus(serviceClient(), brokerId);
  return hasAccess(status);
});

/**
 * The live slideshow is a paid feature. If the owner's plan has lapsed the
 * public link goes dark — EXCEPT the owner / their team / an admin may still
 * preview it (RLS lets exactly those people read the listing row).
 */
export async function canViewSlideshow(listing: SlideshowListing): Promise<boolean> {
  if (await ownerHasAccess(listing.broker_id)) return true;
  try {
    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return false;
    const { data: canView } = await supabaseUser.from("listings").select("id").eq("id", listing.id).maybeSingle();
    return !!canView;
  } catch {
    return false;
  }
}

export type SlideshowPhotoRow = {
  id: string;
  storage_path: string;
  category: string | null;
  filename: string | null;
  display_order: number | null;
  derivatives_at: string | null;
};

export type SlideshowVideoRow = {
  id: string;
  storage_path: string;
  storage_host: string | null;
  filename: string | null;
  thumbnail_path: string | null;
};

/** Signed display links the viewer holds, keyed by photo id. Either size may be missing until asked for. */
export type PhotoUrlMap = Record<string, { thumb?: string | null; full?: string | null }>;

export type SlideshowExtras = {
  videos: Record<string, { url: string | null; posterUrl: string | null }>;
  deckPlanUrl: string | null;
};

/** How many grid/filmstrip tiles the server signs for first paint. */
export const FIRST_PAINT_TILES = 12;

/**
 * Visible photos (in show order) + slideshow videos. DB only — no signing.
 * Cached per request so generateMetadata, the page and nothing else re-read.
 */
export const getSlideshowRows = cache(async (listingId: string, manual: boolean, heroId: string | null): Promise<{
  photos: SlideshowPhotoRow[];
  videos: SlideshowVideoRow[];
}> => {
  const supabase = serviceClient();
  const [{ data: photos }, { data: rawVideos }] = await Promise.all([
    supabase
      .from("photos")
      .select("id, storage_path, category, filename, display_order, derivatives_at")
      .eq("listing_id", listingId)
      .eq("is_visible", true)
      .order("display_order"),
    supabase
      .from("videos")
      .select("id, storage_path, storage_host, filename, thumbnail_path")
      .eq("listing_id", listingId)
      .eq("in_slideshow", true)
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("created_at"),
  ]);
  // Default to the canonical walk-the-boat order UNLESS the listing was
  // hand-arranged (photo_order_manual), in which case that order is kept.
  const ordered = orderPhotos((photos ?? []) as SlideshowPhotoRow[], { manual, heroId });
  return { photos: ordered, videos: (rawVideos ?? []) as SlideshowVideoRow[] };
});

export function slideshowRows(listing: SlideshowListing) {
  return getSlideshowRows(listing.id, listing.photo_order_manual === true, listing.hero_photo_id);
}

/**
 * Videos (+ their stills) and the deck plan. Video links come from their own
 * store (one batch call for Supabase; R2 signs locally); stills and the deck
 * plan share ONE createSignedUrls batch on listing-photos.
 */
export async function signSlideshowExtras(
  supabase: SupabaseClient,
  listing: SlideshowListing,
  videos: SlideshowVideoRow[]
): Promise<SlideshowExtras> {
  const originals = [
    ...videos.map((v) => v.thumbnail_path).filter((p): p is string => !!p),
    ...(listing.deck_plan_path ? [listing.deck_plan_path] : []),
  ];
  const [signedVideos, batch] = await Promise.all([
    withVideoUrls(supabase, videos, { expiresIn: SLIDESHOW_TTL }),
    originals.length > 0
      ? supabase.storage.from("listing-photos").createSignedUrls(originals, SLIDESHOW_TTL).then(({ data }) => data ?? [])
      : Promise.resolve([] as { path: string | null; signedUrl: string }[]),
  ]);
  const byPath = new Map(batch.map((d) => [d.path ?? "", d.signedUrl] as const));
  const out: SlideshowExtras = {
    videos: {},
    deckPlanUrl: listing.deck_plan_path ? byPath.get(listing.deck_plan_path) ?? null : null,
  };
  signedVideos.forEach((v) => {
    out.videos[v.id] = { url: v.url, posterUrl: v.thumbnail_path ? byPath.get(v.thumbnail_path) ?? null : null };
  });
  return out;
}

/**
 * What the page sends with the HTML.
 *
 * Photos with stored derivatives: EVERY tile (600) and slide (2000) link, in
 * two batch createSignedUrls calls — cheap however big the boat — so the
 * viewer never has to ask for them.
 *
 * Photos without derivatives yet (not backfilled): the old first-paint rule —
 * the opening photo at slide size + the first dozen tiles via per-photo
 * transform signing (≤ 13 calls); the viewer fetches the rest in chunks
 * through /api/s/[slug]/urls.
 */
export async function signFirstPaint(
  supabase: SupabaseClient,
  photos: { id: string; storage_path: string; derivatives_at?: string | null }[],
  ttl: number
): Promise<PhotoUrlMap> {
  // The fallback caps apply to the first photo / first dozen only: past those,
  // a photo without derivatives is left for the viewer to ask for.
  const firstTiles = new Set(photos.slice(0, FIRST_PAINT_TILES).map((p) => p.id));
  const firstId = photos[0]?.id;
  const [full, thumbs] = await Promise.all([
    signPhotosAtSize(supabase, photos, "full", ttl, { fallbackLimit: 0 }),
    signPhotosAtSize(supabase, photos, "thumb", ttl, { fallbackLimit: 0 }),
  ]);
  const needFull = photos.filter((p) => p.id === firstId && !full[p.id]);
  const needThumb = photos.filter((p) => firstTiles.has(p.id) && !thumbs[p.id]);
  const [fullFb, thumbFb] = await Promise.all([
    needFull.length ? signPhotosAtSize(supabase, needFull, "full", ttl) : Promise.resolve({} as Record<string, string>),
    needThumb.length ? signPhotosAtSize(supabase, needThumb, "thumb", ttl) : Promise.resolve({} as Record<string, string>),
  ]);
  Object.assign(full, fullFb);
  Object.assign(thumbs, thumbFb);
  const map: PhotoUrlMap = {};
  for (const p of photos) {
    const t = thumbs[p.id];
    const f = full[p.id];
    if (t || f) map[p.id] = { thumb: t ?? null, ...(f ? { full: f } : {}) };
  }
  return map;
}

export type { PhotoSize };

/** Broker profile + brokerage card. Cached per request (page + link preview). */
export const getBrokerCard = cache(async (brokerId: string) => {
  const supabase = serviceClient();
  const [{ data: profile }, { data: brokerDetails }] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name, phone").eq("id", brokerId).maybeSingle(),
    supabase.from("broker_details").select("brokerage_name, brokerage_website, logo_url").eq("id", brokerId).maybeSingle(),
  ]);
  return {
    profile: profile as { first_name: string | null; last_name: string | null; phone: string | null } | null,
    brokerDetails: brokerDetails as { brokerage_name: string | null; brokerage_website: string | null; logo_url: string | null } | null,
  };
});

/** "Sea Dream — 2019 65′ Viking" (whatever parts exist). */
export function vesselHeadline(l: { vessel_name: string | null; year: number | null; length_ft: number | null; make: string | null; model?: string | null }): string {
  const extras = [l.year, l.length_ft ? `${l.length_ft}′` : null, l.make].filter(Boolean).join(" ");
  const name = (l.vessel_name ?? "").trim();
  if (name && extras) return `${name} — ${extras}`;
  return name || extras || [l.make, l.model].filter(Boolean).join(" ") || "Yacht";
}
