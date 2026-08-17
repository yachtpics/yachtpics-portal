import { createClient as createServiceClient } from "@supabase/supabase-js";
import { boatPage, brokeragePage, boatsIndexPage, boatSlug, boatLabel, type BoatPageData } from "@/lib/siteTemplates";
import { orderPhotos } from "@/lib/photoOrder";
import { includesPhotos, includesVideo, isSiteMedia, type SiteMedia } from "@/lib/siteMedia";
import { r2Configured, r2Exists, r2Put, r2PublicUrl } from "@/lib/r2";
import type { SiteVideo } from "@/lib/siteTemplates";

/**
 * Is the media host that serves public video configured yet?
 *
 * Video for the website goes to Cloudflare R2 rather than Supabase — bandwidth
 * on R2 is free, which matters when a boat page streams a 300MB clip to anyone
 * who lands on it. Until those credentials exist, video isn't published and
 * pages fall back to photos.
 */
function videoPublishReady(): boolean {
  return r2Configured();
}

/**
 * Copy a listing's videos to the public media host and return their URLs.
 *
 * ONLY videos on a boat being published reach this bucket — it is world
 * readable, so nothing lands there that hasn't been deliberately put on the
 * public website. Client video stays private in Supabase.
 *
 * Deliberately does NOT filter on `in_slideshow`. That flag governs the CLIENT
 * slideshow inside the portal, and an earlier version of this reused it here on
 * the reasoning that "hidden means hidden". That was wrong: it made the website
 * silently depend on an unrelated switch, so a boat set to publish video came
 * back with "nothing to publish" and no way to guess why. The per-boat
 * Photos/Video/Both choice is the decision about the website; nothing else
 * should quietly override it.
 *
 * Keyed by video id, so re-publishing a boat doesn't re-upload anything and
 * URLs stay stable for caching.
 */
async function syncVideos(
  listingId: string,
  sitePage: string,
  slug: string,
  heroPhotoUrl: string | null
): Promise<SiteVideo[]> {
  const svc = service();
  const { data: rows } = await svc
    .from("videos")
    .select("id, storage_path, filename, thumbnail_path, title, description, display_order, created_at")
    .eq("listing_id", listingId)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!rows?.length) return [];

  const out: SiteVideo[] = [];
  for (const v of rows) {
    const src = v.storage_path as string;
    const ext = (src.split(".").pop() || "mp4").toLowerCase();
    const key = `${sitePage}/${slug}/${v.id}.${ext}`;

    // The file must ALREADY be on the media host. Publishing does not copy it.
    //
    // The first version copied here, inline: download the whole video, then
    // upload it. That crashed on the first real boat — a 1.2GB drone file is
    // more memory than a serverless function has and more time than it gets, so
    // the request died and the browser received an HTML error page instead of
    // an answer. Copying now happens beforehand, in 64MB parts, driven from the
    // admin page where it can show progress and survive a dropped connection
    // (see /api/admin/media/copy-video). Publishing just assembles the page.
    if (!(await r2Exists(key))) continue;

    // Poster frame, in order of preference:
    //   1. the boat's cover photo — already on the public host, and it's the
    //      shot deliberately chosen to represent this vessel
    //   2. the still captured from the video at upload
    //   3. nothing, and the browser shows a black box
    //
    // The cover photo wins because a frame grabbed a second into a clip can be
    // a lens flare or half a dock, and on a page selling a yacht — for a
    // photography business — that shouldn't be the first thing anyone sees.
    // Posters are a few hundred KB, so they're safe to copy inline here.
    let poster: string | null = heroPhotoUrl;
    if (!poster && v.thumbnail_path) {
      const posterKey = `${sitePage}/${slug}/poster-${v.id}.jpg`;
      try {
        if (!(await r2Exists(posterKey))) {
          const { data: blob } = await svc.storage.from("listing-photos").download(v.thumbnail_path as string);
          if (blob) await r2Put(posterKey, Buffer.from(await blob.arrayBuffer()), "image/jpeg");
        }
        poster = r2PublicUrl(posterKey);
      } catch {
        poster = null;
      }
    }

    out.push({
      url: r2PublicUrl(key),
      poster,
      title: (v.title as string | null) ?? null,
      description: (v.description as string | null) ?? null,
      filename: (v.filename as string) ?? null,
    });
  }

  return out;
}

// Publishes a listing to yachtpics.com. Two independent vetoes apply, per the
// brief: ours (publish_to_site) and the broker's (showcase_opt_out — the
// pocket-listing veto). Either one blocks it.
//
// Note this deliberately does NOT touch /s/[slug]: that route is subscription
// gated ("the live client slideshow is a paid feature") and must never be what
// feeds the public website.

const PUBLIC_BUCKET = "site-photos";
const PRIVATE_BUCKET = "listing-photos";

export type SiteFile = { path: string; content: string };

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export function publicPhotoUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PUBLIC_BUCKET}/${path}`;
}

type ListingRow = {
  id: string;
  vessel_name: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  length_ft: string | null;
  vessel_type: string | null;
  location: string | null;
  status: string | null;
  showcase_opt_out: boolean | null;
  publish_to_site: boolean | null;
  site_slug: string | null;
  hero_photo_id: string | null;
  photo_order_manual: boolean | null;
  site_media: string | null;
  broker_id: string;
};

/** Copy a listing's visible photos into the public bucket; returns public URLs. */
async function syncPhotos(listing: ListingRow, sitePage: string, slug: string): Promise<string[]> {
  const svc = service();
  const { data: photoRows } = await svc
    .from("photos")
    .select("id, storage_path, category, display_order")
    .eq("listing_id", listing.id)
    .eq("is_visible", true)
    .order("display_order", { ascending: true });

  // Default to the canonical walk-the-boat order (profiles → tower → flybridge →
  // … → master) UNLESS the broker/assistant hand-arranged this listing — then
  // their exact drag order is respected. photo_order_manual flips true the moment
  // anyone drags a photo or clicks "Sort to standard order", so an untouched
  // listing gets the standard sequence automatically instead of raw upload order.
  const rows = orderPhotos(photoRows ?? [], {
    manual: listing.photo_order_manual === true,
    heroId: listing.hero_photo_id,
  });

  // Name each public file by its stable photo ID — NOT by its position. The
  // order lives only in the HTML (the sequence of <img> tags), so re-ordering a
  // boat just rewrites the page; no image files need to change. This avoids the
  // trap of position names (001.jpg, 002.jpg…): copy() can't overwrite an
  // existing object, so a re-order used to leave the old image frozen at each
  // slot. ID names are immutable content, which also keeps CDN/browser caching
  // correct.
  const urls: string[] = [];
  const jobs = rows.map((r) => {
    const src = r.storage_path as string;
    const ext = (src.split(".").pop() || "jpg").toLowerCase();
    const dest = `${sitePage}/${slug}/${r.id}.${ext}`;
    urls.push(publicPhotoUrl(dest));
    return { src, dest };
  });

  // Server-side copies — the bytes never travel through this function.
  // Chunked so a 100+ photo boat doesn't open 100 sockets at once. An existing
  // file is fine: the ID name means it already holds this photo's bytes, so we
  // skip it. Any other error falls back to a download + upsert.
  for (let i = 0; i < jobs.length; i += 8) {
    await Promise.all(
      jobs.slice(i, i + 8).map(async (j) => {
        const { error } = await svc.storage
          .from(PRIVATE_BUCKET)
          .copy(j.src, j.dest, { destinationBucket: PUBLIC_BUCKET });
        if (error && !/exists/i.test(error.message)) {
          const { data: blob } = await svc.storage.from(PRIVATE_BUCKET).download(j.src);
          if (blob) {
            await svc.storage.from(PUBLIC_BUCKET).upload(j.dest, blob, { upsert: true });
          }
        }
      })
    );
  }

  return urls;
}

/**
 * Render the Boats index (yacht-photos.html) from the site_pages taxonomy.
 *
 * A page is listed only if its .html actually exists on the site, so a
 * brand-new brokerage doesn't create a dead link before its first boat ships.
 * "Exists" = we captured its archive when seeding (archive_checked_at set), OR
 * it has a published boat (which generated its page). Listed alphabetically by
 * name so a newly added brokerage slots into place instead of landing at the
 * end — no sort_order bookkeeping to keep up with.
 */
export async function renderBoatsIndex(): Promise<SiteFile | null> {
  const svc = service();

  // Only pages that actually exist on the server (has_page), so the index never
  // links to a brokerage page that hasn't been generated yet.
  const { data: pages } = await svc
    .from("site_pages")
    .select("label, filename")
    .eq("is_active", true)
    .eq("has_page", true);
  if (!pages || pages.length === 0) return null;

  const listed = pages
    .map((p) => ({ label: p.label as string, filename: p.filename as string }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
  return { path: "yacht-photos.html", content: boatsIndexPage(listed) };
}

const SITEMAP_SITE = "https://www.yachtpics.com";

function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Regenerate sitemap.xml from live data: the core marketing pages, every active
 * brokerage page, and — the piece that was missing entirely — every published
 * BOAT page (the image-rich pages we actually want indexed). Rebuilt on each
 * publish with today's date, so Google always sees the newest boats and drops
 * retired pages. Deactivated brokerages (is_active/has_page false) fall out
 * automatically.
 */
export async function renderSitemap(): Promise<SiteFile> {
  const svc = service();
  const today = new Date().toISOString().slice(0, 10);

  // Core hand-built marketing pages, with the priorities the old sitemap used.
  const core: [string, string][] = [
    ["", "1.0"],
    ["gallery.html", "0.9"],
    ["contact.html", "0.9"],
    ["video.html", "0.8"],
    ["yacht-photos.html", "0.8"],
    ["team.html", "0.6"],
    ["marine-industry-blog.html", "0.5"],
  ];

  const { data: pages } = await svc
    .from("site_pages")
    .select("filename")
    .eq("is_active", true)
    .eq("has_page", true)
    .order("filename", { ascending: true });

  // Published boats live at {site_page}/{slug}/index.html. A boat only reaches a
  // brokerage page when its site_page is set, so that's the accurate source.
  const { data: boats } = await svc
    .from("listings")
    .select("site_page, site_slug")
    .eq("publish_to_site", true)
    .eq("status", "active")
    .eq("showcase_opt_out", false)
    .not("site_page", "is", null)
    .not("site_slug", "is", null);

  const rows: { loc: string; priority: string }[] = [];
  for (const [path, pr] of core) rows.push({ loc: `${SITEMAP_SITE}/${path}`, priority: pr });
  for (const p of pages ?? []) rows.push({ loc: `${SITEMAP_SITE}/${p.filename}.html`, priority: "0.7" });
  for (const b of boats ?? []) {
    rows.push({ loc: `${SITEMAP_SITE}/${b.site_page}/${b.site_slug}/index.html`, priority: "0.8" });
  }

  const body = rows
    .map((u) => `  <url><loc>${xmlEsc(u.loc)}</loc><lastmod>${today}</lastmod><priority>${u.priority}</priority></url>`)
    .join("\n");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  return { path: "sitemap.xml", content: xml };
}

/** robots.txt — allow everything, and point crawlers at the sitemap. */
export function renderRobots(): SiteFile {
  return {
    path: "robots.txt",
    content: `User-agent: *\nAllow: /\n\nSitemap: ${SITEMAP_SITE}/sitemap.xml\n`,
  };
}

/**
 * Resolve which website page a listing belongs on.
 *
 * The listing's own `site_page` wins — that's the picker on the listing form.
 * Falls back to the broker's brokerage mapping where one exists. Most brokers
 * have no brokerage record at all (84% of listings, as of Jul 2026), which is
 * exactly why the per-listing pick exists.
 */
export async function resolveSitePage(listingId: string): Promise<string | null> {
  const svc = service();
  const { data: l } = await svc
    .from("listings")
    .select("site_page, broker_id")
    .eq("id", listingId)
    .maybeSingle();
  if (!l) return null;
  if (l.site_page) return l.site_page;

  const { data: broker } = await svc
    .from("profiles")
    .select("brokerage_id")
    .eq("id", l.broker_id)
    .maybeSingle();
  if (!broker?.brokerage_id) return null;

  const { data: brokerage } = await svc
    .from("brokerages")
    .select("site_page")
    .eq("id", broker.brokerage_id)
    .maybeSingle();
  return brokerage?.site_page ?? null;
}

/** Render a website page: portal boats on top, the Juicebox archive below. */
export async function renderSitePage(sitePage: string): Promise<SiteFile | null> {
  const svc = service();

  const { data: page } = await svc
    .from("site_pages")
    .select("label, filename")
    .eq("filename", sitePage)
    .maybeSingle();
  if (!page) return null;

  // Longest boat first — the convention the hand-built archive has always used.
  // Ordering by published_at would sort by whatever order they happened to get
  // toggled, which looks unsorted sitting above an archive that isn't.
  const { data: published } = await svc
    .from("listings")
    .select("vessel_name, make, length_ft, site_slug")
    .eq("site_page", sitePage)
    .eq("publish_to_site", true)
    .eq("showcase_opt_out", false)
    .eq("status", "active")
    .order("length_ft", { ascending: false, nullsFirst: false });

  const { data: archive } = await svc
    .from("brokerage_site_archive")
    .select("label, href")
    .eq("site_page", sitePage)
    .order("sort_order", { ascending: true });

  const html = brokeragePage({
    sitePage: page.filename,
    brokerageName: page.label,
    boats: (published ?? [])
      .filter((b) => b.site_slug)
      .map((b) => ({
        label: boatLabel({ lengthFt: b.length_ft, make: b.make, vesselName: b.vessel_name }),
        slug: b.site_slug as string,
      })),
    archive: (archive ?? []).map((a) => ({ label: a.label, href: a.href })),
  });

  return { path: `${page.filename}.html`, content: html };
}

/**
 * Build every file needed to publish a listing: its slideshow page plus the
 * regenerated brokerage page. Returns the files rather than uploading them, so
 * the caller can preview before pushing anything live.
 */
export async function buildListingFiles(listingId: string): Promise<{ files: SiteFile[]; slug: string; label: string } | { error: string }> {
  const svc = service();

  const { data: listing } = await svc
    .from("listings")
    .select("id, vessel_name, year, make, model, length_ft, vessel_type, location, status, showcase_opt_out, publish_to_site, site_slug, hero_photo_id, photo_order_manual, site_media, broker_id")
    .eq("id", listingId)
    .maybeSingle();
  if (!listing) return { error: "Listing not found" };

  const l = listing as ListingRow;
  if (l.status !== "active") return { error: "Listing is not active" };
  if (l.showcase_opt_out) return { error: "The broker marked this a pocket listing — it can't be published." };
  if (!l.publish_to_site) return { error: "Listing isn't switched on for the website yet." };

  const { data: broker } = await svc
    .from("profiles")
    .select("id, first_name, last_name, display_email, phone, brokerage_id")
    .eq("id", l.broker_id)
    .maybeSingle();

  const sitePage = await resolveSitePage(l.id);
  if (!sitePage) {
    return { error: "No website page chosen for this boat — pick a brokerage page on the listing first." };
  }

  const { data: page } = await svc
    .from("site_pages")
    .select("label, filename, archive_checked_at")
    .eq("filename", sitePage)
    .maybeSingle();
  if (!page) return { error: `"${sitePage}" isn't a known website page.` };

  const brokerage = { name: page.label, site_page: page.filename };

  const label = boatLabel({ lengthFt: l.length_ft, make: l.make, vesselName: l.vessel_name });
  const slug = l.site_slug || boatSlug({ lengthFt: l.length_ft, make: l.make, vesselName: l.vessel_name });
  if (!slug) return { error: "Can't build a URL for this boat — it needs at least a name or make." };

  // Refuse to publish to a page whose existing galleries we've never captured.
  //
  // The publisher rewrites a brokerage page wholesale — new boats plus archive —
  // so if the archive was never read out of the live HTML, publishing silently
  // deletes years of Juicebox galleries and every inbound link to them. Fail
  // closed: an error is recoverable, a wiped page isn't. Seed with
  // scripts/seed-site-archive.mjs, which also stamps archive_checked_at.
  if (!page.archive_checked_at) {
    return {
      error:
        `"${page.label}" hasn't had its existing galleries captured yet. Publishing now ` +
        `could wipe them off the page. Run scripts/seed-site-archive.mjs first.`,
    };
  }

  // What this boat shows on the site: photos, video, or both.
  //
  // Video publishing isn't wired up yet (it waits on the R2 media host), so a
  // "video" choice would otherwise render a page with nothing on it. Until then
  // photos are included regardless, and the guard resolves itself the moment
  // video publishing goes live — no second edit needed here.
  const media: SiteMedia = isSiteMedia(l.site_media) ? l.site_media : "photos";
  const wantsPhotos = includesPhotos(media) || !videoPublishReady();

  const wantsVideo = includesVideo(media) && videoPublishReady();

  const photos = wantsPhotos ? await syncPhotos(l, brokerage.site_page, slug) : [];
  // syncPhotos returns the ordered list, so the first entry IS the cover photo
  // (the chosen hero, or the first in the walk-the-boat order). That's what the
  // video player uses as its poster.
  const videos = wantsVideo
    ? await syncVideos(l.id, brokerage.site_page, slug, photos[0] ?? null)
    : [];

  // A page has to have something on it. Name the actual cause — the first
  // version of this said "no video made it across to the media host" whatever
  // the reason, which sent us looking at Cloudflare when the real problem was
  // a filter in this file.
  if (photos.length === 0 && videos.length === 0) {
    if (wantsPhotos) return { error: "No visible photos to publish." };

    if (!videoPublishReady()) {
      return { error: "Video publishing isn't configured yet — the media host settings are missing." };
    }

    const { count } = await svc
      .from("videos")
      .select("id", { count: "exact", head: true })
      .eq("listing_id", l.id);

    return {
      error: count
        ? `This boat's video hasn't been copied to the media host yet. Use "Prepare video for the website" on this page first — it copies the file in the background and shows progress.`
        : "This boat is set to publish video, but no video has been uploaded to it.",
    };
  }

  // Persist the slug so the URL is stable even if the boat is renamed later.
  await svc
    .from("listings")
    .update({ site_slug: slug, published_at: new Date().toISOString() })
    .eq("id", l.id);

  const data: BoatPageData = {
    label,
    slug,
    sitePage: brokerage.site_page,
    brokerageName: brokerage.name,
    vesselName: l.vessel_name ?? label,
    year: l.year,
    make: l.make,
    model: l.model,
    lengthFt: l.length_ft,
    vesselType: l.vessel_type,
    location: l.location,
    brokerName: broker?.first_name ? `${broker.first_name} ${broker.last_name ?? ""}`.trim() : null,
    brokerEmail: broker?.display_email ?? null,
    brokerPhone: broker?.phone ?? null,
    photos,
    videos,
  };

  const files: SiteFile[] = [{ path: `${brokerage.site_page}/${slug}/index.html`, content: boatPage(data) }];
  const bpage = await renderSitePage(sitePage);
  if (bpage) files.push(bpage);

  // This brokerage page now exists on the server — mark it so the index lists
  // it. Must happen before renderBoatsIndex so a first-time page appears.
  await svc.from("site_pages").update({ has_page: true }).eq("filename", sitePage);

  // Regenerate the Boats index too, so a first-time page for this brokerage
  // shows up there automatically (no more hand-editing yacht-photos.html).
  const index = await renderBoatsIndex();
  if (index) files.push(index);

  // Keep the sitemap current — all brokerage + boat pages with today's date —
  // and refresh robots.txt, so Google discovers newly published boats.
  files.push(await renderSitemap());
  files.push(renderRobots());

  return { files, slug, label };
}
