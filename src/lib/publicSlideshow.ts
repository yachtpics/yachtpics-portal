import { cache } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { hasAccess } from "@/lib/subscriptionAccess";
import { orderPhotos } from "@/lib/photoOrder";
import { withVideoUrls } from "@/lib/videoUrls";
import { signPhotosAtSize, signOneTransformed, OG_TRANSFORM, type PhotoSize } from "@/lib/publicPhotoUrls";
import { cleanYpToken, ypShareLive } from "@/lib/ypShare";
import type { Metadata } from "next";

/**
 * Shared by the buyer slideshow page (/s/[slug]), its link preview
 * (generateMetadata) and its link-refresh route (/api/s/[slug]/urls), so all
 * three apply exactly the same "may this be shown?" rules and sign media the
 * same way.
 */

/** How long the page's links live. The viewer re-signs before they lapse. */
export const SLIDESHOW_TTL = 7200;

export const LISTING_COLUMNS =
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

/**
 * The YachtPics share link (/yp/{token}, Nov 1 — src/lib/ypShare.ts): the
 * listing behind a token, ONLY when ypShareLive (published + slug + admin
 * switch on). The broker's plan is not consulted — that is the point of this
 * link — and this is the only place that bypass exists: /s/[slug] and
 * /api/s/[slug]/urls keep using canViewSlideshow. Returns the real slideshow
 * slug too (views/events/inquiries are recorded against it). Before
 * migration 20261101b the columns don't exist → null (404).
 */
export const getYpSharedSlideshow = cache(async (rawToken: string): Promise<{ listing: SlideshowListing; slug: string } | null> => {
  const token = cleanYpToken(rawToken);
  if (!token) return null;
  const { data, error } = await serviceClient()
    .from("listings")
    .select(`${LISTING_COLUMNS}, slideshow_slug, slideshow_published, yp_share_enabled, yp_share_token`)
    .eq("yp_share_token", token)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as SlideshowListing & { slideshow_slug: string | null; slideshow_published: boolean | null; yp_share_enabled: boolean | null; yp_share_token: string | null };
  if (!ypShareLive(row)) return null;
  return { listing: row, slug: row.slideshow_slug as string };
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
  title: string | null;
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
      .select("id, storage_path, storage_host, filename, title, thumbnail_path")
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

/** Neutral link preview for anything not showable. */
export const NEUTRAL_SLIDESHOW_METADATA: Metadata = {
  title: "YachtPics Portal",
  description: "Yacht photography presented by YachtPics.",
};

/** Seven days: link-preview crawlers (iMessage, WhatsApp, Facebook) re-fetch lazily. */
const OG_TTL = 60 * 60 * 24 * 7;

/**
 * Rich link preview for a listing the caller has ALREADY decided is showable:
 * vessel name + spec line + "Presented by …", and the hero photo as a
 * 1200×630 card. Shared by /s/[slug] and /yp/[token]. Never throws.
 */
export async function slideshowMetadata(listing: SlideshowListing): Promise<Metadata> {
  try {
    const supabase = serviceClient();
    const [{ photos }, { profile, brokerDetails }] = await Promise.all([
      slideshowRows(listing),
      getBrokerCard(listing.broker_id),
    ]);
    const hero = photos[0];
    const image = hero ? await signOneTransformed(supabase, hero.storage_path, OG_TRANSFORM, OG_TTL) : null;

    const title = vesselHeadline(listing);
    const specs = [
      listing.year,
      listing.length_ft ? `${listing.length_ft}′` : null,
      [listing.make, listing.model].filter(Boolean).join(" ") || null,
      listing.vessel_type,
      listing.location,
    ].filter(Boolean).join(" · ");
    const brokerName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
    const presented = brokerName
      ? `Presented by ${brokerName}${brokerDetails?.brokerage_name ? `, ${brokerDetails.brokerage_name}` : ""}.`
      : brokerDetails?.brokerage_name ? `Presented by ${brokerDetails.brokerage_name}.` : "";
    const description = [specs ? `${specs}.` : "", presented].filter(Boolean).join(" ") || "Photos and video on YachtPics.";

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        siteName: "YachtPics Portal",
        ...(image ? { images: [{ url: image, width: OG_TRANSFORM.width, height: OG_TRANSFORM.height, alt: title }] } : {}),
      },
      twitter: {
        card: image ? "summary_large_image" : "summary",
        title,
        description,
        ...(image ? { images: [image] } : {}),
      },
    };
  } catch {
    return NEUTRAL_SLIDESHOW_METADATA;
  }
}

/**
 * Everything the buyer viewer needs besides the listing: broker card, photos
 * with first-paint links, videos with links, deck plan. Shared by /s/[slug]
 * and /yp/[token] so the two render identically.
 */
export async function slideshowViewerData(listing: SlideshowListing) {
  const supabase = serviceClient();
  // Broker card + photo/video rows (cached — shared with generateMetadata),
  // then ONE light signing step.
  const [{ profile, brokerDetails }, rows] = await Promise.all([
    getBrokerCard(listing.broker_id),
    slideshowRows(listing),
  ]);
  const [firstPaint, extras] = await Promise.all([
    signFirstPaint(supabase, rows.photos, SLIDESHOW_TTL),
    signSlideshowExtras(supabase, listing, rows.videos),
  ]);

  const photos = rows.photos.map((photo) => ({
    id: photo.id,
    category: photo.category,
    filename: photo.filename,
    url: firstPaint[photo.id]?.full ?? null,
    thumbUrl: firstPaint[photo.id]?.thumb ?? null,
  }));

  // Same shape the viewer always got, plus posterUrl (null when no still exists).
  const videos = rows.videos.map((v) => ({
    id: v.id,
    storage_path: v.storage_path,
    storage_host: v.storage_host,
    filename: v.filename,
    title: v.title ?? null,
    url: extras.videos[v.id]?.url ?? null,
    posterUrl: extras.videos[v.id]?.posterUrl ?? null,
  }));

  const broker = {
    name: [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Broker",
    brokerage: brokerDetails?.brokerage_name ?? null,
    phone: profile?.phone ?? null,
    website: brokerDetails?.brokerage_website ?? null,
    logoUrl: brokerDetails?.logo_url ?? null,
  };

  return { broker, photos, videos, deckPlanUrl: extras.deckPlanUrl };
}
