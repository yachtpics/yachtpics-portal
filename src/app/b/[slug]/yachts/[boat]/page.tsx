import type { Metadata } from "next";
import Link from "next/link";
import SlideshowViewer from "@/app/s/[slug]/SlideshowViewer";
import {
  serviceClient,
  signFirstPaint,
  signSlideshowExtras,
  slideshowRows,
  SLIDESHOW_TTL,
} from "@/lib/publicSlideshow";
import { OG_TRANSFORM, signOneTransformed } from "@/lib/publicPhotoUrls";
import { boatLabel, boatSpecs, findSiteBoat, getLiveSite, getSiteBoatListing } from "@/lib/brokerSiteServer";
import { priceLabel } from "@/lib/brokerSite";
import SiteShell, { sectionsShown } from "../../_components/SiteShell";
import Unavailable from "../../_components/Unavailable";
import ShowingButton from "../../_components/ShowingButton";
import { serif } from "../../_components/fonts";

/**
 * /b/[slug]/yachts/[boat] — one boat on a broker's website (Oct 26).
 *
 * The SAME buyer slideshow viewer as /s/[slug] (SlideshowViewer, with
 * `embedded` so the site supplies the chrome), fed by the same loaders in
 * src/lib/publicSlideshow.ts (slideshowRows → signFirstPaint /
 * signSlideshowExtras). The rest of the photo links come from the
 * site-scoped /api/b/[slug]/yachts/[boat]/urls, which applies this page's
 * rules — /s and its route are unchanged.
 *
 * Shown when the site is live (published + websiteEntitlement) and the boat
 * passes the site rule (active, not sold, ≥1 visible photo, not a pocket
 * listing, not switched off) — its slideshow needn't be published. `boat` is
 * the vessel-name key from boatSlugs(), or the listing id.
 *
 * Views and events are recorded like /s with source "site", so the Seller
 * Report counts website visits.
 */
export const revalidate = 3600;

async function load(slug: string, boatKey: string) {
  const live = await getLiveSite(slug).catch(() => null);
  if (!live) return null;
  const boat = findSiteBoat(live, boatKey);
  if (!boat) return { live, boat: null, listing: null };
  const listing = await getSiteBoatListing(boat.row.id);
  return { live, boat, listing };
}

export async function generateMetadata({ params }: { params: { slug: string; boat: string } }): Promise<Metadata> {
  const r = await load(params.slug, params.boat);
  if (!r?.boat || !r.listing) return { title: "This page isn't available", robots: { index: false, follow: false } };
  const l = r.listing;
  const ft = Number(l.length_ft);
  const loaBuilder = [Number.isFinite(ft) && ft > 0 ? `${Math.round(ft)}′` : null, l.make].filter(Boolean).join(" ");
  const vessel = (l.vessel_name ?? "").trim() || [l.year, l.make, l.model].filter(Boolean).join(" ") || "Yacht";
  const title = `${vessel}${loaBuilder ? ` — ${loaBuilder}` : ""} | ${r.live.name}`;
  const description = [boatSpecs(l), l.location].filter(Boolean).join(" · ") || `Presented by ${r.live.name}.`;
  const og = r.boat.cover ? await signOneTransformed(serviceClient(), r.boat.cover.storage_path, OG_TRANSFORM, 60 * 60 * 24 * 7) : null;
  return {
    title,
    description,
    openGraph: { title, description, type: "website", ...(og ? { images: [{ url: og, width: OG_TRANSFORM.width, height: OG_TRANSFORM.height, alt: vessel }] } : {}) },
    twitter: { card: og ? "summary_large_image" : "summary", title, description, ...(og ? { images: [og] } : {}) },
  };
}

export default async function SiteBoatPage({ params }: { params: { slug: string; boat: string } }) {
  const r = await load(params.slug, params.boat);
  if (!r) return <Unavailable />;
  const { live } = r;
  const shown = sectionsShown(live, { yachts: live.boats.filter((b) => !b.sold).length, sold: live.boats.filter((b) => b.sold).length });
  const base = `/b/${live.site.slug}`;

  if (!r.boat || !r.listing) {
    return (
      <SiteShell s={live} shown={shown} base={base}>
        <main className="px-4 sm:px-8 py-24 text-center">
          <p className={`${serif.className} text-[2rem] text-ink-950`}>This yacht isn&rsquo;t available</p>
          <Link href={`${base}#yachts`} className="inline-flex items-center min-h-[44px] mt-4 text-sm font-semibold text-ink-900 border-b border-[var(--site-accent)]">
            See all yachts
          </Link>
        </main>
      </SiteShell>
    );
  }

  const { boat, listing } = r;
  const svc = serviceClient();
  const rows = await slideshowRows(listing);
  const [firstPaint, extras] = await Promise.all([
    signFirstPaint(svc, rows.photos, SLIDESHOW_TTL),
    signSlideshowExtras(svc, listing, rows.videos),
  ]);
  const photos = rows.photos.map((p) => ({
    id: p.id,
    category: p.category,
    filename: p.filename,
    url: firstPaint[p.id]?.full ?? null,
    thumbUrl: firstPaint[p.id]?.thumb ?? null,
  }));
  const videos = rows.videos.map((v) => ({
    id: v.id,
    storage_path: v.storage_path,
    storage_host: v.storage_host,
    filename: v.filename,
    title: v.title ?? null,
    url: extras.videos[v.id]?.url ?? null,
    posterUrl: extras.videos[v.id]?.posterUrl ?? null,
  }));

  const vessel = (listing.vessel_name ?? "").trim() || [listing.year, listing.make, listing.model].filter(Boolean).join(" ") || "Yacht";
  const specs = boatSpecs(listing);
  const price = live.site.show_prices ? priceLabel(listing.asking_price) : null;
  const location = (listing.location ?? "").trim() || null;
  // Session / favourites key for the viewer; views and events go through the
  // same /api/slideshow routes as /s, accepted for this boat via `site`.
  const viewerSlug = `site-${boat.boatSlug}`;

  return (
    <SiteShell s={live} shown={shown} base={base}>
      <main>
        <div className="px-4 sm:px-8 pt-8 sm:pt-12 pb-6">
          <div className="max-w-6xl mx-auto">
            <Link href={`${base}#yachts`} className="inline-flex items-center min-h-[44px] text-sm text-ink-500 hover:text-ink-900">
              ← All yachts
            </Link>
            <div className="mt-2 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div className="min-w-0">
                <h1 className={`${serif.className} text-[2.5rem] sm:text-[3.25rem] leading-[1.02] text-ink-950`}>{vessel}</h1>
                {specs && <p className="text-ink-600 text-[0.9375rem] mt-2">{specs}</p>}
                <p className="mt-2 flex flex-wrap items-baseline gap-x-4 text-[0.9375rem]">
                  <span className="text-ink-900 font-semibold tabular-nums">{price ?? "Price on request"}</span>
                  {location && <span className="text-ink-500">{location}</span>}
                </p>
              </div>
              <div className="shrink-0">
                <ShowingButton slug={live.site.slug} firstName={live.firstName} listingId={listing.id} boatLabel={boatLabel(listing)} serifClass={serif.className} />
              </div>
            </div>
          </div>
        </div>
        <div className="max-w-6xl mx-auto sm:px-8 pb-12">
          <div className="border border-hairline overflow-hidden">
            <SlideshowViewer
              listingId={listing.id}
              slug={viewerSlug}
              listing={listing}
              broker={{ name: live.name, brokerage: live.brokerageName, phone: live.phone, website: live.brokerageWebsite, logoUrl: live.logoUrl }}
              photos={photos}
              videos={videos}
              source="site"
              tourUrl={listing.tour_url ?? null}
              deckPlanUrl={extras.deckPlanUrl}
              urlsEndpoint={`/api/b/${encodeURIComponent(live.site.slug)}/yachts/${listing.id}/urls`}
              embedded
              site={live.site.slug}
            />
          </div>
        </div>
      </main>
    </SiteShell>
  );
}
