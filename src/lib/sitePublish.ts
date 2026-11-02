import { createClient as createServiceClient } from "@supabase/supabase-js";
import { ypShareUrl, type YpShareRow } from "@/lib/ypShare";
import { boatPage, brokeragePage, boatsIndexPage, boatSlug, boatLabel, brokerageDisplayName, displayMake, type BoatPageData } from "@/lib/siteTemplates";
import { derivativePath, hasDerivatives } from "@/lib/photoDerivativePaths";
import { orderPhotos } from "@/lib/photoOrder";
import { includesPhotos, includesVideo, isSiteMedia, type SiteMedia } from "@/lib/siteMedia";
import { r2Configured, r2Exists, r2Put, r2PublicUrl, r2Delete, R2_BUCKET } from "@/lib/r2";
import { copyR2OriginalTo, readOriginal } from "@/lib/photoStore";
import { ftpConfigured, uploadFiles, deleteFiles } from "@/lib/siteFtp";
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
    .order("display_order", { ascending: true, nullsFirst: false })
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
// feeds the public website. The boat page's "View the full slideshow" button
// uses the YachtPics share link (/yp/{token}) instead, which is always live.

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

/**
 * Where a boat page's photos are published (Oct 28, 2026). Its OWN switch,
 * independent of where new uploads go — OFF by default: "supabase" = the
 * public `site-photos` bucket, exactly as before, unless the env var
 * SITE_PHOTOS_BACKEND is exactly "r2" (and the media host is configured):
 * then the public R2 media bucket that already serves the website's video
 * (same `{site_page}/{slug}/` folder, same file names as site-photos used).
 *
 * Which one a live page uses is recorded on the listing
 * (`listings.site_photos_backend`) only AFTER its files reached the website —
 * see markSitePhotosBackend — so the gated site-photos cleanup never removes
 * a file a live page still points at.
 */
export type SitePhotosBackend = "supabase" | "r2";
export function sitePhotosBackend(): SitePhotosBackend {
  const env = (process.env.SITE_PHOTOS_BACKEND || "").trim().toLowerCase();
  return env === "r2" && r2Configured() ? "r2" : "supabase";
}

/**
 * Time one publish may spend copying photos to the R2 media host (the routes
 * that build pages run for at most 60 s). Copies already made are skipped
 * next time, so a big boat finishes over a couple of publishes.
 */
const R2_SYNC_BUDGET_MS = 35_000;

/**
 * Record where this boat's live page points its photos. "r2": call after a
 * successful upload. "supabase": call before uploading — it only clears an
 * earlier "r2" mark (a no-op write for every boat that was never on R2).
 */
export async function markSitePhotosBackend(listingId: string, backend: SitePhotosBackend): Promise<void> {
  let q = service()
    .from("listings")
    .update({ site_photos_backend: backend === "r2" ? "r2" : null })
    .eq("id", listingId);
  if (backend !== "r2") q = q.eq("site_photos_backend", "r2");
  await q.then(() => {}, () => {});
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
async function syncPhotos(
  listing: ListingRow,
  sitePage: string,
  slug: string,
  backend: SitePhotosBackend
): Promise<string[] | { error: string }> {
  const svc = service();
  const { data: photoRows } = await svc
    .from("photos")
    .select("id, storage_path, category, display_order, storage_backend")
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
    urls.push(backend === "r2" ? r2PublicUrl(dest) : publicPhotoUrl(dest));
    return { src, dest, onR2: (r as { storage_backend?: string | null }).storage_backend === "r2" };
  });

  // Public R2 media bucket (Oct 28). Same ID names, so an existing file is
  // already this photo's bytes and is skipped. An R2 original is copied
  // server side; a Supabase one is read and uploaded.
  //
  // Errors are per photo (a photo that can't be copied is left off the page,
  // never failing the whole build). Copying stops starting new photos after
  // R2_SYNC_BUDGET_MS; if any are left, the build reports it and the next
  // publish carries on (finished copies are skipped).
  if (backend === "r2") {
    const started = Date.now();
    const failedDest = new Set<string>();
    let notStarted = 0;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, jobs.length) }, async () => {
        while (next < jobs.length) {
          const j = jobs[next++];
          if (Date.now() - started > R2_SYNC_BUDGET_MS) {
            notStarted++;
            continue;
          }
          try {
            if (await r2Exists(j.dest)) continue;
            if (j.onR2) {
              try {
                await copyR2OriginalTo(j.src, R2_BUCKET, j.dest);
                continue;
              } catch {
                /* fall back to read + upload */
              }
            }
            const { bytes, contentType } = await readOriginal(svc, { storage_path: j.src, storage_backend: j.onR2 ? "r2" : "supabase" });
            await r2Put(j.dest, bytes, contentType);
          } catch {
            failedDest.add(j.dest);
          }
        }
      })
    );
    if (notStarted > 0) {
      return {
        error: `Copying this boat's photos to the media host — ${notStarted} of ${jobs.length} still to go. Publish again to carry on (finished ones are skipped).`,
      };
    }
    if (failedDest.size === 0) return urls;
    const keep = jobs.map((j, k) => (failedDest.has(j.dest) ? null : urls[k])).filter((u): u is string => !!u);
    return keep;
  }

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
          if (j.onR2) {
            // An original on R2 (Supabase can't copy it): read it from R2.
            try {
              const { bytes, contentType } = await readOriginal(svc, { storage_path: j.src, storage_backend: "r2" });
              await svc.storage.from(PUBLIC_BUCKET).upload(j.dest, bytes, { upsert: true, contentType });
            } catch {
              /* left out of the bucket, as when a download fails */
            }
            return;
          }
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
    .map((p) => ({ label: brokerageDisplayName(p.filename as string, p.label as string), filename: p.filename as string }))
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
    ["marine-news.php", "0.6"],
    ["portal.html", "0.7"],
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
    brokerageName: brokerageDisplayName(page.filename, page.label),
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

// ─── latest-boats.json — the home page's "Just photographed" strip (Nov 2) ──
//
// yachtpics.com/index.html is hand-written, so it can't be regenerated on each
// publish like the brokerage pages. Instead it loads this small JSON feed with
// a few lines of vanilla JS. The feed rides along with every publish (the same
// FTP upload as the boat page, sitemap.xml and yacht-photos.html) and every
// takedown, so the strip is always current without anyone editing index.html.
//
// Order: newest SHOOT first — photographed_at, falling back to created_at.
// NOT published_at: the "Re-publish live boats" job rewrites published_at on
// every live boat (all 102 read Oct 30 05:03–06:43 after the last run), so it
// says nothing about which boats are new.
//
// Photo: a ~600 px WebP "card" copy of the cover photo on the media host
// (`{site_page}/{slug}/card-{photoId}.webp`, ~30 KB) — the originals are
// ~1.5 MB each, too heavy for eight cards on the home page. The card is made
// at publish (syncCoverCard) from the 600 px derivative the Portal already
// keeps; a boat without one falls back to its full-size cover photo.

export const LATEST_BOATS_PATH = "latest-boats.json";
const LATEST_BOATS_MAX = 24;
const SITE_URL = "https://www.yachtpics.com";

export type LatestBoat = {
  name: string;
  spec: string;
  brokerage: string;
  url: string;
  photo: string | null;
  publishedAt: string | null;
  photographedAt: string | null;
};

function cardKey(sitePage: string, slug: string, photoId: string): string {
  return `${sitePage}/${slug}/card-${photoId}.webp`;
}

/** Photo id from a published photo URL (`…/{site_page}/{slug}/{photoId}.jpg`). */
function photoIdFromUrl(url: string): string | null {
  const file = url.split("?")[0].split("/").pop() ?? "";
  const id = file.replace(/\.[a-z0-9]+$/i, "");
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/**
 * Put the card-size copy of a boat's cover photo on the media host, if it
 * isn't there yet. Best effort: no derivative / no R2 → nothing happens and
 * the feed uses the full-size cover instead.
 */
async function syncCoverCard(sitePage: string, slug: string, coverUrl: string | undefined): Promise<void> {
  if (!coverUrl || !r2Configured()) return;
  const id = photoIdFromUrl(coverUrl);
  if (!id) return;
  const key = cardKey(sitePage, slug, id);
  try {
    if (await r2Exists(key)) return;
    const svc = service();
    const { data: p } = await svc
      .from("photos")
      .select("id, storage_path, derivatives_at")
      .eq("id", id)
      .maybeSingle();
    if (!p || !hasDerivatives(p as { derivatives_at: string | null })) return;
    const { data: blob } = await svc.storage
      .from(PRIVATE_BUCKET)
      .download(derivativePath({ id: p.id as string, storage_path: p.storage_path as string }, 600));
    if (!blob || blob.size === 0) return;
    await r2Put(key, Buffer.from(await blob.arrayBuffer()), "image/webp");
  } catch {
    /* the feed falls back to the full-size cover */
  }
}

type FeedListingRow = {
  id: string;
  vessel_name: string | null;
  make: string | null;
  length_ft: string | number | null;
  site_page: string;
  site_slug: string;
  hero_photo_id: string | null;
  photo_order_manual: boolean | null;
  site_photos_backend: string | null;
  photographed_at: string | null;
  created_at: string | null;
  published_at: string | null;
};

/**
 * Render latest-boats.json: up to 24 live boat pages, newest shoot first.
 * `justPublished` = the boat this publish is for — its live page now uses
 * this build's photo backend even though the listing isn't marked yet.
 */
export async function renderLatestBoatsFeed(justPublished?: {
  listingId: string;
  photosBackend: SitePhotosBackend;
}): Promise<SiteFile> {
  const svc = service();
  const { data } = await svc
    .from("listings")
    .select("id, vessel_name, make, length_ft, site_page, site_slug, hero_photo_id, photo_order_manual, site_photos_backend, photographed_at, created_at, published_at")
    .eq("publish_to_site", true)
    .eq("status", "active")
    .eq("showcase_opt_out", false)
    .not("site_page", "is", null)
    .not("site_slug", "is", null);

  const when = (r: FeedListingRow) => Date.parse(r.photographed_at ?? r.created_at ?? "") || 0;
  const rows = ((data ?? []) as FeedListingRow[]).sort((a, b) => when(b) - when(a)).slice(0, LATEST_BOATS_MAX);

  const pageNames = new Map<string, string>();
  const pagesWanted = Array.from(new Set(rows.map((r) => r.site_page)));
  if (pagesWanted.length) {
    const { data: pages } = await svc.from("site_pages").select("filename, label").in("filename", pagesWanted);
    for (const p of pages ?? []) pageNames.set(p.filename as string, brokerageDisplayName(p.filename as string, p.label as string));
  }

  // One small query per boat for its cover (the walk-the-boat order needs
  // every visible photo's category), eight at a time.
  const boats: LatestBoat[] = new Array(rows.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, rows.length) }, async () => {
      while (next < rows.length) {
        const k = next++;
        const r = rows[k];
        let photo: string | null = null;
        try {
          const { data: ph } = await svc
            .from("photos")
            .select("id, storage_path, category, display_order")
            .eq("listing_id", r.id)
            .eq("is_visible", true);
          const cover = orderPhotos((ph ?? []) as { id: string; storage_path: string; category: string | null; display_order: number | null }[], {
            manual: r.photo_order_manual === true,
            heroId: r.hero_photo_id,
          })[0];
          if (cover) {
            const card = cardKey(r.site_page, r.site_slug, cover.id);
            if (r2Configured() && (await r2Exists(card).catch(() => false))) {
              photo = r2PublicUrl(card);
            } else {
              const ext = (cover.storage_path.split(".").pop() || "jpg").toLowerCase();
              const dest = `${r.site_page}/${r.site_slug}/${cover.id}.${ext}`;
              const backend = justPublished?.listingId === r.id ? justPublished.photosBackend : r.site_photos_backend === "r2" ? "r2" : "supabase";
              photo = backend === "r2" ? r2PublicUrl(dest) : publicPhotoUrl(dest);
            }
          }
        } catch {
          photo = null;
        }
        const len = r.length_ft != null && String(r.length_ft).trim() !== "" ? `${String(r.length_ft).trim()}′` : "";
        boats[k] = {
          name: r.vessel_name?.trim() || boatLabel({ lengthFt: r.length_ft == null ? null : String(r.length_ft), make: r.make, vesselName: null }),
          spec: [len, displayMake(r.make)].filter(Boolean).join(" "),
          brokerage: pageNames.get(r.site_page) ?? "",
          url: `${SITE_URL}/${r.site_page}/${r.site_slug}/index.html`,
          photo,
          publishedAt: r.published_at,
          photographedAt: r.photographed_at ?? r.created_at,
        };
      }
    })
  );

  return { path: LATEST_BOATS_PATH, content: JSON.stringify(boats.filter(Boolean), null, 1) + "\n" };
}

/**
 * Build every file needed to publish a listing: its slideshow page plus the
 * regenerated brokerage page. Returns the files rather than uploading them, so
 * the caller can preview before pushing anything live.
 */
/**
 * Take a boat off yachtpics.com.
 *
 * Unpublishing means OFF the website — not merely unlinked. So: switch the
 * record off, delete the boat page, delete its video from the public media
 * host, and rewrite the brokerage page so the link goes with it. Photos stay
 * in the portal, video stays in the portal — the broker loses nothing, and the
 * boat can go back up later.
 *
 * Shared by two callers so a boat always comes down the same way:
 *   - the admin publish switch (an explicit decision by YachtPics), and
 *   - the broker's pocket-listing veto (marking a boat private after it went
 *     live has to actually take it down, or the veto means nothing).
 */
export async function unpublishFromSite(
  listingId: string
): Promise<{ warnings: string[]; error?: string }> {
  const svc = service();
  const warnings: string[] = [];

  await svc
    .from("listings")
    .update({ publish_to_site: false, published_at: null })
    .eq("id", listingId);

  const { data: l } = await svc
    .from("listings")
    .select("site_page, site_slug")
    .eq("id", listingId)
    .maybeSingle();

  const sitePage = (l?.site_page as string | null) ?? (await resolveSitePage(listingId));
  const slug = (l?.site_slug as string | null) ?? null;

  // Deletes ONLY from the public website bucket (yachtpics-media). The
  // portal's own private copy lives in a different bucket and is never touched
  // here, so the broker can still watch and send the video afterwards.
  //
  // Public video goes first: it shouldn't be watchable a moment longer than
  // necessary. Photos in the public bucket are left alone — orphaned but
  // harmless, and keeping them makes re-publishing quick.
  if (sitePage && slug && r2Configured()) {
    const { data: vids } = await svc
      .from("videos")
      .select("id, storage_path")
      .eq("listing_id", listingId);
    for (const v of vids ?? []) {
      const ext = ((v.storage_path as string).split(".").pop() || "mp4").toLowerCase();
      await r2Delete(`${sitePage}/${slug}/${v.id}.${ext}`).catch(() => {
        warnings.push("A video couldn't be removed from the media host.");
      });
      await r2Delete(`${sitePage}/${slug}/poster-${v.id}.jpg`).catch(() => {});
    }
  }

  if (ftpConfigured()) {
    if (sitePage && slug) {
      const res = await deleteFiles([`${sitePage}/${slug}/index.html`]);
      if (res.error) warnings.push(`The boat page couldn't be deleted: ${res.error}`);
    }
    if (sitePage) {
      const page = await renderSitePage(sitePage);
      // The home page's "Just photographed" feed drops the boat too.
      const files: SiteFile[] = [await renderLatestBoatsFeed()];
      if (page) files.unshift(page);
      const res = await uploadFiles(files);
      if (res.error) return { warnings, error: res.error };
    }
  }

  return { warnings };
}

export async function buildListingFiles(listingId: string): Promise<{ files: SiteFile[]; slug: string; label: string; photosBackend: SitePhotosBackend } | { error: string }> {
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

  const brokerage = { name: brokerageDisplayName(page.filename, page.label), site_page: page.filename };

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

  const photosBackend = sitePhotosBackend();
  const synced = wantsPhotos ? await syncPhotos(l, brokerage.site_page, slug, photosBackend) : [];
  if (!Array.isArray(synced)) return { error: synced.error };
  const photos = synced;
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

  // "View the full slideshow →" (Nov 1): the YachtPics share link — always
  // live whatever the broker's plan (src/lib/ypShare.ts), tagged ?via=site so
  // those views report as "yachtpics.com". Read separately so a missing
  // column (migration 20261101b not applied) just leaves the button off.
  let slideshowUrl: string | null = null;
  {
    const { data: yp, error: ypErr } = await svc
      .from("listings")
      .select("slideshow_published, slideshow_slug, yp_share_enabled, yp_share_token")
      .eq("id", l.id)
      .maybeSingle();
    if (!ypErr) slideshowUrl = ypShareUrl(yp as YpShareRow | null, "site");
  }

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
    slideshowUrl,
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

  // The home page's "Just photographed" strip: card-size cover on the media
  // host first, then the feed (which looks for that card).
  await syncCoverCard(brokerage.site_page, slug, photos[0]);
  files.push(await renderLatestBoatsFeed({ listingId: l.id, photosBackend }));

  return { files, slug, label, photosBackend };
}
