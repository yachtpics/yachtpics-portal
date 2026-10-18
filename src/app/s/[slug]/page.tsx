import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import SlideshowViewer from "./SlideshowViewer";
import { orderPhotos } from "@/lib/photoOrder";
import {
  canViewSlideshow,
  getPublishedSlideshow,
  loadSlideshowMedia,
  ownerHasAccess,
  serviceClient,
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
    const [{ data: photos }, { data: profile }, { data: brokerDetails }] = await Promise.all([
      supabase
        .from("photos")
        .select("id, storage_path, category, filename, display_order")
        .eq("listing_id", listing.id)
        .eq("is_visible", true)
        .order("display_order"),
      supabase.from("profiles").select("first_name, last_name").eq("id", listing.broker_id).maybeSingle(),
      supabase.from("broker_details").select("brokerage_name").eq("id", listing.broker_id).maybeSingle(),
    ]);
    const hero = orderPhotos(photos ?? [], {
      manual: listing.photo_order_manual === true,
      heroId: listing.hero_photo_id,
    })[0];
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

  // Broker card + every signed link at once. Photos come at two sizes (tile
  // and main slide) — see src/lib/publicPhotoUrls.ts.
  const [{ data: profile }, { data: brokerDetails }, media] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name, phone")
      .eq("id", listing.broker_id)
      .single(),
    supabase
      .from("broker_details")
      .select("brokerage_name, brokerage_website, logo_url")
      .eq("id", listing.broker_id)
      .maybeSingle(),
    loadSlideshowMedia(supabase, listing),
  ]);

  const withUrls = media.photos.map((photo) => ({
    id: photo.id,
    category: photo.category,
    filename: photo.filename,
    url: media.urls.photos[photo.id]?.full ?? null,
    thumbUrl: media.urls.photos[photo.id]?.thumb ?? null,
  }));

  // Same shape the viewer always got, plus posterUrl (null when no still exists).
  const videos = media.videos.map((v) => ({
    id: v.id,
    storage_path: v.storage_path,
    storage_host: v.storage_host,
    filename: v.filename,
    url: media.urls.videos[v.id]?.url ?? null,
    posterUrl: media.urls.videos[v.id]?.posterUrl ?? null,
  }));

  const broker = {
    name:
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
      "Broker",
    brokerage: brokerDetails?.brokerage_name ?? null,
    phone: (profile as { phone?: string | null } | null)?.phone ?? null,
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
      deckPlanUrl={media.urls.deckPlanUrl}
    />
  );
}
