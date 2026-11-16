/**
 * Website text for yachtpics.com boat pages — server side (Nov 16, 2026).
 *
 * listings.site_description is YachtPics' own text for the public page,
 * separate from the broker's listings.description. This file holds the parts
 * the admin routes and the `site_text_drafts` job share:
 *
 *   pickDescribePhotoUrls   the same photo pick as the broker "Draft with AI"
 *                           (cover + one per distinct area, up to six, signed
 *                           800 px / q70 for 10 minutes)
 *   draftSiteTextForListing load the facts + photos and ask the model (no save)
 *   suggestLocationFromPhotos  read the cover photo's embedded City / State
 *                           (never written to `location` from here)
 *
 * SERVER ONLY (service-role client, storage, sharp).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftSiteDescription, type SiteDescribable } from "@/lib/ai";
import { orderPhotos } from "@/lib/photoOrder";
import { readOriginal, signResizedPath } from "@/lib/photoStore";
import { loadSharp } from "@/lib/photoSharp";
import { locationFromMetadata } from "@/lib/photoLocation";
import { displayMake } from "@/lib/siteTemplates";

type PickRow = { id: string; storage_path: string; storage_backend?: string | null; category: string | null; display_order: number | null; filename?: string | null };

/** Visible photos in show order (manual order / hero honoured). */
async function orderedVisiblePhotos(
  svc: SupabaseClient,
  listingId: string,
  order: { photo_order_manual: boolean | null; hero_photo_id: string | null }
): Promise<PickRow[]> {
  const { data: photos } = await svc
    .from("photos")
    .select("id, storage_path, storage_backend, category, display_order, filename")
    .eq("listing_id", listingId)
    .eq("is_visible", true)
    .order("display_order");
  return orderPhotos((photos ?? []) as PickRow[], { manual: order.photo_order_manual === true, heroId: order.hero_photo_id });
}

/**
 * Cover, then one of each distinct area, up to six — enough for the feel of
 * the boat without paying for the whole gallery. Signed URLs (10 min) of an
 * 800 × 800 "contain" JPEG at quality 70 — Supabase's resize, or the stored
 * 600/2000 px copy for an original on R2 (photoStore).
 */
export async function pickDescribePhotoUrls(
  svc: SupabaseClient,
  listingId: string,
  order: { photo_order_manual: boolean | null; hero_photo_id: string | null }
): Promise<string[]> {
  const ordered = await orderedVisiblePhotos(svc, listingId, order);
  const picked: PickRow[] = [];
  const seen: Record<string, true> = {};
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i];
    const key = p.category ?? "Other";
    if (picked.length === 0 || !seen[key]) { picked.push(p); seen[key] = true; }
    if (picked.length >= 6) break;
  }
  const urls = await Promise.all(picked.map((p) =>
    signResizedPath(svc, p.storage_path, 600, { width: 800, height: 800, resize: "contain", quality: 70 }, { ensure: true })
  ));
  return urls.filter(Boolean) as string[];
}

const LISTING_FIELDS =
  "id, vessel_name, vessel_type, year, make, model, length_ft, engines, staterooms, location, hero_photo_id, photo_order_manual";

type ListingFacts = SiteDescribable & { id: string; hero_photo_id: string | null; photo_order_manual: boolean | null };

/**
 * Draft website text for one boat. Nothing is saved. The broker's
 * description is not read (and never sent to the model).
 */
export async function draftSiteTextForListing(svc: SupabaseClient, listingId: string): Promise<string> {
  const { data, error } = await svc.from("listings").select(LISTING_FIELDS).eq("id", listingId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Listing not found");
  const l = data as unknown as ListingFacts;
  const urls = await pickDescribePhotoUrls(svc, l.id, l);
  if (urls.length === 0) throw new Error("No visible photos to draft from.");
  // The gallery's own areas, in show order, so the text follows the shoot.
  const all = await orderedVisiblePhotos(svc, l.id, l);
  const areas: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const c = (all[i].category ?? "").trim();
    if (c && c.toLowerCase() !== "other" && areas.indexOf(c) < 0) areas.push(c);
  }
  return draftSiteDescription(
    {
      vessel_name: l.vessel_name,
      vessel_type: l.vessel_type,
      year: l.year,
      make: displayMake(l.make),
      model: l.model,
      length_ft: l.length_ft,
      engines: l.engines,
      staterooms: l.staterooms,
      location: l.location,
      areas: areas.slice(0, 24),
      photoCount: all.length,
    },
    urls
  );
}

/**
 * "City, ST" from the cover photo's embedded metadata (XMP, then IPTC IIM),
 * or null when it has none. Reads ONE original (the cover / first visible
 * photo) through photoStore; sharp only parses the header. Throws only on a
 * storage/decoder failure, so the caller can log it.
 */
export async function suggestLocationFromPhotos(
  svc: SupabaseClient,
  listing: { id: string; hero_photo_id: string | null; photo_order_manual: boolean | null }
): Promise<string | null> {
  const ordered = await orderedVisiblePhotos(svc, listing.id, listing);
  const cover = ordered[0];
  if (!cover) return null;
  const sharp = await loadSharp();
  if (!sharp) throw new Error("the image library isn't available on this server");
  const { bytes } = await readOriginal(svc, { storage_path: cover.storage_path, storage_backend: cover.storage_backend ?? null });
  const meta = await sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).metadata();
  return locationFromMetadata({ xmp: meta.xmp ?? null, iptc: meta.iptc ?? null });
}
