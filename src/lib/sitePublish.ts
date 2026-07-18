import { createClient as createServiceClient } from "@supabase/supabase-js";
import { boatPage, brokeragePage, boatsIndexPage, boatSlug, boatLabel, type BoatPageData } from "@/lib/siteTemplates";
import { orderPhotos } from "@/lib/photoOrder";

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

  // Publish in display_order — Charlie uploads straight out of Lightroom in
  // viewing order, so display_order IS the intended order. Deliberately NOT
  // category-sorted here: "Head" is one label covering several rooms, each
  // interleaved next to its own stateroom, and a category sort would clump them
  // all together and break that. The canonical order is applied by an explicit
  // "sort to standard order" action instead, which rewrites display_order so the
  // portal, client sends and the website all agree.
  const rows = orderPhotos(photoRows ?? [], {
    manual: true,
    heroId: listing.hero_photo_id,
  });

  const urls: string[] = [];
  const jobs = rows.map((r, i) => {
    const src = r.storage_path as string;
    const ext = (src.split(".").pop() || "jpg").toLowerCase();
    const dest = `${sitePage}/${slug}/${String(i + 1).padStart(3, "0")}.${ext}`;
    urls.push(publicPhotoUrl(dest));
    return { src, dest };
  });

  // Server-side copies — the bytes never travel through this function.
  // Chunked so a 100+ photo boat doesn't open 100 sockets at once.
  for (let i = 0; i < jobs.length; i += 8) {
    await Promise.all(
      jobs.slice(i, i + 8).map(async (j) => {
        const { error } = await svc.storage
          .from(PRIVATE_BUCKET)
          .copy(j.src, j.dest, { destinationBucket: PUBLIC_BUCKET });
        // An existing file is fine — republishing overwrites in place.
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
 * it has a published boat (which generated its page). Ordered by sort_order to
 * match the hand-built index.
 */
export async function renderBoatsIndex(): Promise<SiteFile | null> {
  const svc = service();

  // Only pages that actually exist on the server (has_page), so the index never
  // links to a brokerage page that hasn't been generated yet.
  const { data: pages } = await svc
    .from("site_pages")
    .select("label, filename")
    .eq("is_active", true)
    .eq("has_page", true)
    .order("sort_order", { ascending: true, nullsFirst: false });
  if (!pages || pages.length === 0) return null;

  const listed = pages.map((p) => ({ label: p.label as string, filename: p.filename as string }));
  return { path: "yacht-photos.html", content: boatsIndexPage(listed) };
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
    .select("id, vessel_name, year, make, model, length_ft, vessel_type, location, status, showcase_opt_out, publish_to_site, site_slug, hero_photo_id, photo_order_manual, broker_id")
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

  const photos = await syncPhotos(l, brokerage.site_page, slug);
  if (photos.length === 0) return { error: "No visible photos to publish." };

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

  return { files, slug, label };
}
