import type { Metadata } from "next";
import { headers } from "next/headers";
import SlideshowViewer from "@/app/s/[slug]/SlideshowViewer";
import {
  getYpSharedSlideshow,
  NEUTRAL_SLIDESHOW_METADATA,
  slideshowMetadata,
  slideshowViewerData,
} from "@/lib/publicSlideshow";
import { ypSourceFromVia } from "@/lib/ypShare";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /yp/[token] — the YachtPics share link (Nov 1; src/lib/ypShare.ts).
 *
 * The listing's buyer slideshow, rendered exactly as /s/[slug] renders it
 * (same viewer, same data helper, the broker's name/brokerage/card), but
 * ALWAYS live: getYpSharedSlideshow requires only slideshow_published +
 * yp_share_enabled — the broker's plan is not checked. Only YachtPics issues
 * it (yachtpics.com boat pages ?via=site, our reel captions ?via=social).
 *
 * View-only, like any buyer: the viewer has no send/share/QR actions; the
 * owner-preview bar never shows here (ownerPreview=false, even for the owner
 * signed in), and no send-token attribution. Views/events/inquiries are
 * recorded against the listing's real slideshow slug with source
 * yp_site / yp_social / yachtpics.
 */
export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  try {
    const hit = await getYpSharedSlideshow(params.token);
    if (!hit) return NEUTRAL_SLIDESHOW_METADATA;
    return await slideshowMetadata(hit.listing);
  } catch {
    return NEUTRAL_SLIDESHOW_METADATA;
  }
}

export default async function YachtPicsSharePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { via?: string };
}) {
  headers();

  const hit = await getYpSharedSlideshow(params.token);
  if (!hit) {
    // Switched off, unpublished, or unknown — the same neutral message /s uses.
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

  const { listing, slug } = hit;
  const source = ypSourceFromVia(searchParams.via);
  const { broker, photos, videos, deckPlanUrl } = await slideshowViewerData(listing);

  return (
    <SlideshowViewer
      listingId={listing.id}
      slug={slug}
      listing={listing}
      broker={broker}
      photos={photos}
      videos={videos}
      brokerId={listing.broker_id}
      source={source}
      sendToken={null}
      tourUrl={listing.tour_url ?? null}
      deckPlanUrl={deckPlanUrl}
      urlsEndpoint={`/api/yp/${encodeURIComponent(params.token.trim().toLowerCase())}/urls`}
      ownerPreview={false}
    />
  );
}
