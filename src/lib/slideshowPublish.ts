/**
 * Create Slideshow — the ONE definition of what publishing a listing's buyer
 * slideshow changes (Oct 29). Client-safe; used by the broker's listing page,
 * the admin listing page and the admin "Slideshow ready" preparer, so a
 * slideshow YachtPics prepares is exactly what the broker's own button makes.
 *
 * Publishing writes two columns and nothing else: a slug (kept if the listing
 * already has one, else 8 random base-36 characters) and the published flag.
 * No database trigger reacts to them (only trg_protect_listing_ownership,
 * which guards broker_id / is_shared), and no code sends an email, push,
 * website publish, showcase change or social post on publish. Cover photo and
 * order are not touched — the slideshow reads hero_photo_id and the photo
 * order at view time. While the broker has no plan the public link stays
 * private (canViewSlideshow in src/lib/publicSlideshow.ts).
 */

export function newSlideshowSlug(): string {
  return Math.random().toString(36).substring(2, 10);
}

/** The update Create Slideshow applies to a listing row. */
export function slideshowPublishUpdate(existingSlug: string | null | undefined): { slideshow_slug: string; slideshow_published: true } {
  return { slideshow_slug: existingSlug || newSlideshowSlug(), slideshow_published: true };
}
