import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import SlideshowViewer from "./SlideshowViewer";
import {
  canViewSlideshow,
  getBrokerCard,
  getPublishedSlideshow,
  ownerHasAccess,
  serviceClient,
  signFirstPaint,
  signSlideshowExtras,
  slideshowRows,
  SLIDESHOW_TTL,
  vesselHeadline,
} from "@/lib/publicSlideshow";
import { OG_TRANSFORM, signOneTransformed } from "@/lib/publicPhotoUrls";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NEUTRAL_METADATA: Metadata = {
  title: "YachtPics Portal",
  description: "Yacht photography presented by YachtPics.",
};

/** Seven days: link-preview crawlers (iMessage, WhatsApp, Facebook) re-fetch lazily. */
const OG_TTL = 60 * 60 * 24 * 7;

/**
 * Rich link preview: vessel name + spec line + "Presented by …", and the hero
 * photo as a 1200×630 card. Anything not showable (unpublished, lapsed plan,
 * missing) gets a neutral title and no image — never an error.
 */
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  try {
    const listing = await getPublishedSlideshow(params.slug);
    if (!listing || !(await ownerHasAccess(listing.broker_id))) return NEUTRAL_METADATA;
    const supabase = serviceClient();
    // Same cached reads the page uses — one DB pass per request.
    const [{ photos }, { profile, brokerDetails }] = await Promise.all([
      slideshowRows(listing),
      getBrokerCard(listing.broker_id),
    ]);
    const hero = photos[0];
    const image = hero ? await signOneTransformed(supabase, hero.storage_path, OG_TRANSFORM, OG_TTL) : null;

    const title = vesselHeadline(listing);
    const specs = [
      listing.year,
      listing.length_ft ? `${listing.length_ft}′` : null,
      [listing.make, listing.model].filter(Boolean).join(" ") || null,
      listing.vessel_type,
      listing.location,
    ].filter(Boolean).join(" · ");
    const brokerName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
    const presented = brokerName
      ? `Presented by ${brokerName}${brokerDetails?.brokerage_name ? `, ${brokerDetails.brokerage_name}` : ""}.`
      : brokerDetails?.brokerage_name ? `Presented by ${brokerDetails.brokerage_name}.` : "";
    const description = [specs ? `${specs}.` : "", presented].filter(Boolean).join(" ") || "Photos and video on YachtPics.";

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        siteName: "YachtPics Portal",
        ...(image ? { images: [{ url: image, width: OG_TRANSFORM.width, height: OG_TRANSFORM.height, alt: title }] } : {}),
      },
      twitter: {
        card: image ? "summary_large_image" : "summary",
        title,
        description,
        ...(image ? { images: [image] } : {}),
      },
    };
  } catch {
    return NEUTRAL_METADATA;
  }
}

export default async function PublicSlideshowPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { src?: string; t?: string };
}) {
  headers();

  // Where did this view come from? (qr, send, share, social… defaults to link)
  const source = (searchParams.src ?? "link").toString().slice(0, 24).replace(/[^a-z0-9_-]/gi, "") || "link";
  // A tracked Send-to-Client link carries a token; opens get attributed to that recipient.
  const sendToken = (searchParams.t ?? "").toString().slice(0, 40).replace(/[^a-z0-9]/gi, "") || null;

  const supabase = serviceClient();

  const listing = await getPublishedSlideshow(params.slug);
  if (!listing) notFound();

  // The live client slideshow is a paid feature. If the owning broker's plan has
  // lapsed (and no office plan covers them), the public link goes dark until they
  // resubscribe — EXCEPT the owner / their team / an admin can still preview it
  // themselves (so they see what they're missing). Buyers see a neutral message.
  // The same rule guards the link-refresh route (/api/s/[slug]/urls).
  if (!(await canViewSlideshow(listing))) {
    return (
      <div className="min-h-screen bg-ink-950 flex items-center justify-center px-10 py-16">
        <div className="max-w-md text-center">
          <p className="text-white text-xl font-light uppercase tracking-caps-wide [text-indent:0.24em] leading-none">
            YachtPics
          </p>
          <span aria-hidden className="mx-auto mt-4 block h-px w-24 bg-white/25" />
          <p className="mt-4 text-[0.6875rem] font-medium uppercase tracking-caps-wide [text-indent:0.24em] text-accent-300/90">
            Portal
          </p>
          <p className="mt-6 text-[0.9375rem] text-ink-300 leading-relaxed">
            This presentation is temporarily unavailable. Please contact the broker for the latest photos and details.
          </p>
        </div>
      </div>
    );
  }

  // Broker card + photo/video rows (cached — shared with generateMetadata),
  // then ONE light signing step: the opening photo at slide size, the first
  // dozen tiles, and video/still/deck-plan links. The viewer fetches the rest
  // of the display links in chunks from /api/s/[slug]/urls as it needs them.
  const [{ profile, brokerDetails }, rows] = await Promise.all([
    getBrokerCard(listing.broker_id),
    slideshowRows(listing),
  ]);
  const [firstPaint, extras] = await Promise.all([
    signFirstPaint(supabase, rows.photos, SLIDESHOW_TTL),
    signSlideshowExtras(supabase, listing, rows.videos),
  ]);

  const withUrls = rows.photos.map((photo) => ({
    id: photo.id,
    category: photo.category,
    filename: photo.filename,
    url: firstPaint[photo.id]?.full ?? null,
    thumbUrl: firstPaint[photo.id]?.thumb ?? null,
  }));

  // Same shape the viewer always got, plus posterUrl (null when no still exists).
  const videos = rows.videos.map((v) => ({
    id: v.id,
    storage_path: v.storage_path,
    storage_host: v.storage_host,
    filename: v.filename,
    title: v.title ?? null,
    url: extras.videos[v.id]?.url ?? null,
    posterUrl: extras.videos[v.id]?.posterUrl ?? null,
  }));

  const broker = {
    name:
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
      "Broker",
    brokerage: brokerDetails?.brokerage_name ?? null,
    phone: profile?.phone ?? null,
    website: brokerDetails?.brokerage_website ?? null,
    logoUrl: brokerDetails?.logo_url ?? null,
  };

  return (
    <SlideshowViewer
      listingId={listing.id}
      slug={params.slug}
      listing={listing}
      broker={broker}
      photos={withUrls}
      videos={videos}
      brokerId={listing.broker_id}
      source={source}
      sendToken={sendToken}
      tourUrl={listing.tour_url ?? null}
      deckPlanUrl={extras.deckPlanUrl}
    />
  );
}
