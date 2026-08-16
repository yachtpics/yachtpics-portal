/**
 * What a boat puts on yachtpics.com.
 *
 * Deliberately distinct from two nearby ideas that are easy to confuse:
 *  - `listings.publish_to_site` — whether the boat is on the website at all
 *  - `videos.in_slideshow`      — whether a video appears in the CLIENT
 *                                 slideshow, which is a paid portal feature and
 *                                 nothing to do with the public site
 *
 * Defaults to "photos", which is what every boat already live was doing before
 * this existed.
 */

export const SITE_MEDIA_VALUES = ["photos", "video", "both"] as const;
export type SiteMedia = (typeof SITE_MEDIA_VALUES)[number];

export function isSiteMedia(value: unknown): value is SiteMedia {
  return typeof value === "string" && (SITE_MEDIA_VALUES as readonly string[]).includes(value);
}

export const SITE_MEDIA_OPTIONS: { value: SiteMedia; label: string; title: string }[] = [
  { value: "photos", label: "Photos", title: "Photos only — how every boat on the site works today" },
  { value: "video", label: "Video", title: "Video only — no photo slideshow on the page" },
  { value: "both", label: "Both", title: "Photo slideshow and video on the same page" },
];

/** Does this choice put photos on the page? */
export function includesPhotos(m: SiteMedia): boolean {
  return m === "photos" || m === "both";
}

/** Does this choice put video on the page? */
export function includesVideo(m: SiteMedia): boolean {
  return m === "video" || m === "both";
}
