/**
 * YachtPics share link (Nov 1) — pure helpers, safe on server and client.
 *
 * A listing's slideshow has two public addresses:
 *   /s/{slideshow_slug}   the broker's own link — dark to the public while the
 *                         broker has no plan (src/lib/publicSlideshow.ts).
 *   /yp/{yp_share_token}  the YachtPics link — ALWAYS live while the slideshow
 *                         is published and listings.yp_share_enabled is on.
 *                         Only YachtPics hands it out: yachtpics.com boat pages
 *                         (?via=site) and the reels we post (?via=social).
 *                         Brokers never see it in the portal.
 *
 * The token is a separate random value (not the slideshow slug), so a broker
 * without a plan can't turn their dark /s/ link into a live one by editing
 * the path. Columns: migration 20261101b_yp_share_link.sql (a trigger stops
 * anyone but an admin / the service role changing them).
 *
 * Views through it are recorded with source "yp_site", "yp_social", or
 * "yachtpics" (no / unknown ?via), grouped as "YachtPics" in reporting.
 */

export const YP_SHARE_ORIGIN = "https://portal.yachtpics.com";

export type YpVia = "site" | "social";

export type YpShareRow = {
  slideshow_published?: boolean | null;
  slideshow_slug?: string | null;
  yp_share_enabled?: boolean | null;
  yp_share_token?: string | null;
};

/** Token shape: what the migration's default produces (10 hex) or any short [a-z0-9]. */
export function cleanYpToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return /^[a-z0-9]{6,40}$/.test(t) ? t : null;
}

/**
 * THE gate for /yp/{token}: the slideshow must be published (with a slug) and
 * the admin switch on. The broker's plan is deliberately NOT consulted.
 */
export function ypShareLive(row: YpShareRow | null | undefined): boolean {
  return !!row && row.slideshow_published === true && !!row.slideshow_slug && row.yp_share_enabled === true && !!cleanYpToken(row.yp_share_token);
}

/** The share link, or null when it isn't live. */
export function ypShareUrl(row: YpShareRow | null | undefined, via?: YpVia): string | null {
  if (!ypShareLive(row)) return null;
  const base = `${YP_SHARE_ORIGIN}/yp/${row!.yp_share_token}`;
  return via ? `${base}?via=${via}` : base;
}

/** ?via= → the source stored on slideshow_views / slideshow_events / listing_leads. */
export function ypSourceFromVia(via: unknown): "yp_site" | "yp_social" | "yachtpics" {
  const v = typeof via === "string" ? via.trim().toLowerCase() : "";
  if (v === "site") return "yp_site";
  if (v === "social") return "yp_social";
  return "yachtpics";
}

export const YP_SOURCES = ["yp_site", "yp_social", "yachtpics"] as const;

export const YP_SOURCE_LABEL: Record<string, string> = {
  yp_site: "yachtpics.com",
  yp_social: "YachtPics social",
  yachtpics: "YachtPics link",
};

export function isYpSource(source: string | null | undefined): boolean {
  return !!source && (YP_SOURCES as readonly string[]).indexOf(source) >= 0;
}

/**
 * "Where views come from": split a by-source list into the broker's own
 * sources and the YachtPics group (yachtpics.com, YachtPics social, …).
 */
export function splitYpSources<T extends { source: string; views: number }>(bySource: T[]): { own: T[]; yp: T[]; ypTotal: number } {
  const own: T[] = [];
  const yp: T[] = [];
  for (const s of bySource) (isYpSource(s.source) ? yp : own).push(s);
  yp.sort((a, b) => YP_SOURCES.indexOf(a.source as (typeof YP_SOURCES)[number]) - YP_SOURCES.indexOf(b.source as (typeof YP_SOURCES)[number]));
  return { own, yp, ypTotal: yp.reduce((n, s) => n + s.views, 0) };
}

/** The last line we add to captions of reels YachtPics posts. */
export function slideshowCaptionLine(url: string): string {
  return `Every photo: ${url}`;
}

/** Append the "Every photo:" line once (no-op without a link, or if it's already there). */
export function withSlideshowLine(caption: string, url: string | null | undefined): string {
  if (!url) return caption;
  if (caption.includes(url) || /(^|\n)Every photo:/.test(caption)) return caption;
  const body = caption.replace(/\s+$/, "");
  return body ? `${body}\n\n${slideshowCaptionLine(url)}` : slideshowCaptionLine(url);
}
