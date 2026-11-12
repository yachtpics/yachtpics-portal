import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import SlideshowViewer from "./SlideshowViewer";
import { isDemoBroker } from "@/lib/demoServer";
import { assistantPlanCopy } from "@/lib/planValue";
import {
  canViewSlideshow,
  getPublishedSlideshow,
  NEUTRAL_SLIDESHOW_METADATA,
  ownerHasAccess,
  serviceClient,
  slideshowMetadata,
  slideshowViewerData,
} from "@/lib/publicSlideshow";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Rich link preview (src/lib/publicSlideshow.ts slideshowMetadata — shared
 * with /yp/[token]). Anything not showable (unpublished, lapsed plan,
 * missing) gets a neutral title and no image — never an error.
 */
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  try {
    const listing = await getPublishedSlideshow(params.slug);
    if (!listing || !(await ownerHasAccess(listing.broker_id))) return NEUTRAL_SLIDESHOW_METADATA;
    const meta = await slideshowMetadata(listing);
    // The read-only demo's sample boat (M2): never indexed. (This page sets no
    // response headers of its own, so the meta tag is the whole of it.)
    if (await isDemoBroker(serviceClient(), listing.broker_id)) {
      return { ...meta, robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } } };
    }
    return meta;
  } catch {
    return NEUTRAL_SLIDESHOW_METADATA;
  }
}

export default async function PublicSlideshowPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { src?: string; from?: string; t?: string; preview?: string };
}) {
  headers();

  // Where did this view come from? (qr, send, share, social… defaults to link)
  // `?from=` wins: a boat-show dock card's QR carries the show key
  // (`?from=flibs26`), and it is recorded on the view and on every event of
  // the visit so "Scanned at FLIBS 2026" can be counted.
  const source =
    (searchParams.from ?? searchParams.src ?? "link").toString().slice(0, 24).replace(/[^a-z0-9_-]/gi, "") || "link";
  // A tracked Send-to-Client link carries a token; opens get attributed to that recipient.
  const sendToken = (searchParams.t ?? "").toString().slice(0, 40).replace(/[^a-z0-9]/gi, "") || null;

  const listing = await getPublishedSlideshow(params.slug);
  if (!listing) notFound();

  // The live client slideshow is a paid feature. If the owning broker's plan has
  // lapsed (and no office plan covers them), the public link goes dark until they
  // resubscribe — EXCEPT the owner / their team / an admin can still preview it
  // themselves (so they see what they're missing). Buyers see a neutral message.
  // The same rule guards the link-refresh route (/api/s/[slug]/urls).
  // Owner preview (Oct 29): the "Slideshow ready" email links here with
  // ?preview=1. If the owner's plan has lapsed and nobody is signed in, send
  // them to sign in and straight back (same-site path only — safeNextPath on
  // the login page). Without ?preview=1 the public sees the neutral message.
  const ownerLive = await ownerHasAccess(listing.broker_id);
  const canView = ownerLive || (await canViewSlideshow(listing));
  if (!canView && searchParams.preview === "1") {
    let signedIn = false;
    try {
      const { data: { user } } = await (await createServerClient()).auth.getUser();
      signedIn = !!user;
    } catch { /* treat as signed out */ }
    if (!signedIn) {
      const back = `/s/${encodeURIComponent(params.slug)}?preview=1`;
      redirect(`/auth/login?next=${encodeURIComponent(back)}`);
    }
  }
  // Seen by the owner / their team / an admin while the owner has no plan:
  // show the quiet "this is what your buyer sees" bar and don't count it as a
  // buyer view.
  const ownerPreview = canView && !ownerLive;
  // An assistant previewing (Nov 11): name the broker, no "Choose a plan".
  let ownerPreviewNote: string | null = null;
  if (ownerPreview) {
    try {
      const { data: { user } } = await (await createServerClient()).auth.getUser();
      if (user) {
        const svc = serviceClient();
        const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
        if (me?.role === "assistant") {
          const { data: bp } = await svc.from("profiles").select("first_name, last_name").eq("id", listing.broker_id).maybeSingle();
          const copy = assistantPlanCopy({ first: bp?.first_name, last: bp?.last_name });
          ownerPreviewNote = `This is what buyers will see. Sending it and the share link are off ${copy.untilPlan}.`;
        }
      }
    } catch { /* fall back to the broker wording */ }
  }

  if (!canView) {
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

  // Broker card, photos/videos with first-paint links, deck plan — the same
  // helper /yp/[token] uses, so both render identically.
  const { broker, photos: withUrls, videos, deckPlanUrl } = await slideshowViewerData(listing);

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
      deckPlanUrl={deckPlanUrl}
      ownerPreview={ownerPreview}
      ownerPreviewNote={ownerPreviewNote}
    />
  );
}
