/**
 * The boats featured on the public /see page, and where their showcase reels
 * live in the private R2 video bucket.
 *
 * Not to be confused with the yachtpics.com website ("publish to site",
 * `showcase_opt_out`, ShowcaseBoard…) — this is only the Portal's own /see
 * page. Browser-safe: plain data, imported by the Reel Maker and the server.
 *
 * To feature another boat later: add a row to SHOWCASE_BOATS (its listing id,
 * a short key for the R2 folder and its published slideshow slug), make a
 * Walkthrough and an Underway reel on that listing's Reel page and use
 * "Save to showcase". FEATURED_SHOWCASE_KEY picks the boat /see shows.
 */

export type ShowcaseLook = "walkthrough" | "underway";

export const SHOWCASE_LOOKS: { look: ShowcaseLook; label: string }[] = [
  { look: "walkthrough", label: "Walkthrough" },
  { look: "underway", label: "Underway" },
];

export type ShowcaseBoat = {
  /** Folder under showcase/ in the private video bucket. */
  key: string;
  listingId: string;
  /** The listing's published buyer slideshow (/s/{slug}). */
  slideshowSlug: string;
};

export const SHOWCASE_BOATS: ShowcaseBoat[] = [
  // Short Story — 2017 122′ Horizon (Miles Yacht Group)
  { key: "short-story", listingId: "e08da4be-e652-4b30-a611-566850c8a920", slideshowSlug: "r01b4xhu" },
];

export const FEATURED_SHOWCASE_KEY = "short-story";

export function isShowcaseLook(v: unknown): v is ShowcaseLook {
  return v === "walkthrough" || v === "underway";
}

export function showcaseBoatByKey(key: string): ShowcaseBoat | null {
  return SHOWCASE_BOATS.find((b) => b.key === key) ?? null;
}

export function showcaseBoatForListing(listingId: string | null | undefined): ShowcaseBoat | null {
  if (!listingId) return null;
  return SHOWCASE_BOATS.find((b) => b.listingId === listingId) ?? null;
}

/** showcase/{boat}/{look}.mp4 — fixed keys, so a re-save simply replaces the reel. */
export function showcaseReelKey(boatKey: string, look: ShowcaseLook): string {
  return `showcase/${boatKey}/${look}.mp4`;
}
