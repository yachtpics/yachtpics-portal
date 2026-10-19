import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, getSlideshowRows } from "@/lib/publicSlideshow";
import { signDerivatives } from "@/lib/photoDerivatives";
import { OG_TRANSFORM, signOneTransformed } from "@/lib/publicPhotoUrls";
import { r2SignedGetUrl, r2VideoConfigured, r2VideoSize } from "@/lib/r2";
import {
  FEATURED_SHOWCASE_KEY,
  SHOWCASE_LOOKS,
  showcaseBoatByKey,
  showcaseReelKey,
  type ShowcaseLook,
} from "@/content/showcase";

/**
 * Everything the public /see page shows, read server side with the service
 * role. The page is cached for an hour (revalidate), so every link here must
 * outlive that comfortably: public URLs where they exist, otherwise 7-day
 * signed links.
 *
 * Hero: the cover photo's public copy on the yachtpics.com bucket
 * (site-photos, written when the boat was published to the website), resized
 * by Supabase's public render endpoint — a stable, unexpiring URL. If that
 * copy isn't there, the 2000px stored derivative signed for 7 days.
 */

const SEVEN_DAYS = 60 * 60 * 24 * 7;
const SITE_BUCKET = "site-photos";

export type SeeReel = { look: ShowcaseLook; label: string; url: string | null };

export type SeeShowcase = {
  /** "Short Story" */
  vessel: string;
  /** "2017 122′ Horizon" */
  specs: string;
  slideshowHref: string;
  hero: string | null;
  og: string | null;
  reels: SeeReel[];
};

export type SeeStats = { brokers: number; listings: number; photos: number };

function publicRender(path: string, params: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/render/image/public/${SITE_BUCKET}/${path}?${params}`;
}

/** The cover photo's public website copy, if the boat's publish put one there. */
async function publicCoverPath(
  svc: SupabaseClient,
  sitePage: string | null,
  siteSlug: string | null,
  photo: { id: string; storage_path: string }
): Promise<string | null> {
  if (!sitePage || !siteSlug) return null;
  const folder = `${sitePage}/${siteSlug}`;
  try {
    const { data } = await svc.storage.from(SITE_BUCKET).list(folder, { search: photo.id, limit: 5 });
    const hit = (data ?? []).find((o) => o.name.startsWith(`${photo.id}.`));
    return hit ? `${folder}/${hit.name}` : null;
  } catch {
    return null;
  }
}

async function signReel(key: string): Promise<string | null> {
  if (!r2VideoConfigured()) return null;
  try {
    // Missing object → "coming soon" on the page, never a broken player.
    if (!(await r2VideoSize(key))) return null;
    return await r2SignedGetUrl(key, { expiresIn: SEVEN_DAYS });
  } catch {
    return null;
  }
}

export const getSeeShowcase = cache(async (): Promise<SeeShowcase | null> => {
  const boat = showcaseBoatByKey(FEATURED_SHOWCASE_KEY);
  if (!boat) return null;
  const svc = serviceClient();

  const reelsP = Promise.all(
    SHOWCASE_LOOKS.map(async ({ look, label }) => ({ look, label, url: await signReel(showcaseReelKey(boat.key, look)) }))
  );

  try {
    const { data: listing } = await svc
      .from("listings")
      .select("id, vessel_name, year, length_ft, make, model, hero_photo_id, photo_order_manual, site_page, site_slug")
      .eq("id", boat.listingId)
      .maybeSingle();
    if (!listing) return { vessel: "", specs: "", slideshowHref: `/s/${boat.slideshowSlug}`, hero: null, og: null, reels: await reelsP };

    // Same order (and so the same cover) the buyer slideshow opens on.
    const { photos } = await getSlideshowRows(listing.id, listing.photo_order_manual === true, listing.hero_photo_id);
    const cover = photos[0] ?? null;

    let hero: string | null = null;
    let og: string | null = null;
    if (cover) {
      const pub = await publicCoverPath(svc, listing.site_page, listing.site_slug, cover);
      if (pub) {
        hero = publicRender(pub, "width=2000&height=2000&resize=contain&quality=82");
        og = publicRender(pub, `width=${OG_TRANSFORM.width}&height=${OG_TRANSFORM.height}&resize=cover&quality=${OG_TRANSFORM.quality}`);
      } else {
        const [{ urls }, ogSigned] = await Promise.all([
          signDerivatives(svc, [cover], 2000, SEVEN_DAYS),
          signOneTransformed(svc, cover.storage_path, OG_TRANSFORM, SEVEN_DAYS),
        ]);
        hero = urls[cover.id] ?? null;
        og = ogSigned;
      }
    }

    return {
      vessel: (listing.vessel_name ?? "").trim(),
      specs: [listing.year, listing.length_ft ? `${listing.length_ft}′` : null, listing.make, listing.model].filter(Boolean).join(" "),
      slideshowHref: `/s/${boat.slideshowSlug}`,
      hero,
      og,
      reels: await reelsP,
    };
  } catch {
    return { vessel: "", specs: "", slideshowHref: `/s/${boat.slideshowSlug}`, hero: null, og: null, reels: await reelsP };
  }
});

/** Every value of one column, paged past PostgREST's 1,000-row cap. */
async function allValues(svc: SupabaseClient, table: string, column: string, eq?: [string, string]): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const base = svc.from(table).select(column);
    const { data, error } = await (eq ? base.eq(eq[0], eq[1]) : base).order(column).range(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Record<string, string | null>[];
    rows.forEach((r) => { const v = r[column]; if (v) out.push(v); });
    if (rows.length < 1000) break;
  }
  return out;
}

/**
 * Live figures for "In numbers". Any failure → null, and the page omits the
 * section rather than show a wrong number.
 */
export const getSeeStats = cache(async (): Promise<SeeStats | null> => {
  try {
    const svc = serviceClient();
    const [brokerIds, listingBrokerIds, listings, photos] = await Promise.all([
      allValues(svc, "profiles", "id", ["role", "broker"]),
      allValues(svc, "listings", "broker_id"),
      svc.from("listings").select("id", { count: "exact", head: true }),
      svc.from("photos").select("id", { count: "exact", head: true }),
    ]);
    if (listings.error || photos.error || listings.count == null || photos.count == null) return null;
    const withListing = new Set(listingBrokerIds);
    const brokers = brokerIds.filter((id) => withListing.has(id)).length;
    return { brokers, listings: listings.count, photos: photos.count };
  } catch {
    return null;
  }
});
