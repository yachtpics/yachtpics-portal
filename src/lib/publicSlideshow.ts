import { cache } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { hasAccess } from "@/lib/subscriptionAccess";
import { orderPhotos } from "@/lib/photoOrder";
import { withVideoPosters, withVideoUrls } from "@/lib/videoUrls";
import { signPhotoSizes, type PhotoSizes } from "@/lib/publicPhotoUrls";

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
};

export type SlideshowVideoRow = {
  id: string;
  storage_path: string;
  storage_host: string | null;
  filename: string | null;
  thumbnail_path: string | null;
};

/** What the viewer needs to (re)paint: signed links keyed by id. */
export type SlideshowUrls = {
  photos: Record<string, PhotoSizes>;
  videos: Record<string, { url: string | null; posterUrl: string | null }>;
  deckPlanUrl: string | null;
};

/**
 * Load the visible photos (in show order) and slideshow videos, and sign
 * everything at once: photos at two sizes, videos + their stills, deck plan.
 */
export async function loadSlideshowMedia(supabase: SupabaseClient, listing: SlideshowListing): Promise<{
  photos: SlideshowPhotoRow[];
  videos: SlideshowVideoRow[];
  urls: SlideshowUrls;
}> {
  const [{ data: photos }, { data: rawVideos }] = await Promise.all([
    supabase
      .from("photos")
      .select("id, storage_path, category, filename, display_order")
      .eq("listing_id", listing.id)
      .eq("is_visible", true)
      .order("display_order"),
    supabase
      .from("videos")
      .select("id, storage_path, storage_host, filename, thumbnail_path")
      .eq("listing_id", listing.id)
      .eq("in_slideshow", true)
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("created_at"),
  ]);

  const photoRows = (photos ?? []) as SlideshowPhotoRow[];
  const videoRows = (rawVideos ?? []) as SlideshowVideoRow[];

  const [sizes, signedVideos, videoPosters, deckPlanUrl] = await Promise.all([
    signPhotoSizes(supabase, photoRows.map((p) => p.storage_path), SLIDESHOW_TTL),
    withVideoUrls(supabase, videoRows, { expiresIn: SLIDESHOW_TTL }),
    withVideoPosters(supabase, videoRows, { expiresIn: SLIDESHOW_TTL }),
    // The deck plan is a diagram people zoom into — kept at original size.
    listing.deck_plan_path
      ? supabase.storage
          .from("listing-photos")
          .createSignedUrl(listing.deck_plan_path, SLIDESHOW_TTL)
          .then(({ data }) => data?.signedUrl ?? null)
      : Promise.resolve(null as string | null),
  ]);

  // Default to the canonical walk-the-boat order UNLESS the listing was
  // hand-arranged (photo_order_manual), in which case that order is kept.
  const ordered = orderPhotos(photoRows, {
    manual: listing.photo_order_manual === true,
    heroId: listing.hero_photo_id,
  });

  const urls: SlideshowUrls = { photos: {}, videos: {}, deckPlanUrl };
  for (const p of ordered) urls.photos[p.id] = sizes.get(p.storage_path) ?? { thumb: null, full: null };
  signedVideos.forEach((v, i) => {
    urls.videos[v.id] = { url: v.url, posterUrl: videoPosters[i]?.posterUrl ?? null };
  });

  return { photos: ordered, videos: videoRows, urls };
}

/** "Sea Dream — 2019 65′ Viking" (whatever parts exist). */
export function vesselHeadline(l: { vessel_name: string | null; year: number | null; length_ft: number | null; make: string | null; model?: string | null }): string {
  const extras = [l.year, l.length_ft ? `${l.length_ft}′` : null, l.make].filter(Boolean).join(" ");
  const name = (l.vessel_name ?? "").trim();
  if (name && extras) return `${name} — ${extras}`;
  return name || extras || [l.make, l.model].filter(Boolean).join(" ") || "Yacht";
}
