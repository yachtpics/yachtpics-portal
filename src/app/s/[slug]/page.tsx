import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import SlideshowViewer from "./SlideshowViewer";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { hasAccess } from "@/lib/subscriptionAccess";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublicSlideshowPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { src?: string };
}) {
  headers();

  // Where did this view come from? (qr, send, share, social… defaults to link)
  const source = (searchParams.src ?? "link").toString().slice(0, 24).replace(/[^a-z0-9_-]/gi, "") || "link";

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: listing } = await supabase
    .from("listings")
    .select("id, vessel_name, vessel_type, year, length_ft, make, model, asking_price, location, broker_id, description, beam_ft, draft_ft, staterooms, heads, engines, engine_hours, fuel_type, cruising_speed_kn, max_speed_kn, hull_material")
    .eq("slideshow_slug", params.slug)
    .eq("slideshow_published", true)
    .single();

  if (!listing) notFound();

  // The live client slideshow is a paid feature. If the owning broker's plan has
  // lapsed (and no office plan covers them), the link goes dark until they
  // resubscribe. Buyers see a neutral message — no billing details exposed.
  const { status: ownerAccess } = await getEffectiveAccessStatus(supabase, listing.broker_id);
  if (!hasAccess(ownerAccess)) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#050b14", padding: 40, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#fff", letterSpacing: "0.5px" }}>YachtPics <span style={{ color: "#d4a843" }}>Portal</span></p>
          <p style={{ margin: "20px 0 0", fontSize: 15, color: "#c4c9d4", lineHeight: 1.6 }}>This presentation is temporarily unavailable. Please contact the broker for the latest photos and details.</p>
        </div>
      </div>
    );
  }

  const [{ data: profile }, { data: photos }, { data: rawVideos }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("first_name, last_name, phone")
        .eq("id", listing.broker_id)
        .single(),
      supabase
        .from("photos")
        .select("id, storage_path, category, filename, display_order")
        .eq("listing_id", listing.id)
        .eq("is_visible", true)
        .order("display_order"),
      supabase
        .from("videos")
        .select("id, storage_path, filename")
        .eq("listing_id", listing.id)
        .eq("in_slideshow", true)
        .order("created_at"),
    ]);

  const { data: brokerDetails } = await supabase
    .from("broker_details")
    .select("brokerage_name, brokerage_website, logo_url")
    .eq("id", listing.broker_id)
    .maybeSingle();

  // Sign photo URLs
  const paths = (photos ?? []).map(p => p.storage_path);
  const { data: signedData } = paths.length > 0
    ? await supabase.storage.from("listing-photos").createSignedUrls(paths, 7200)
    : { data: [] };
  const urlMap = new Map((signedData ?? []).map(d => [d.path, d.signedUrl]));
  const withUrls = (photos ?? []).map(photo => ({
    ...photo,
    url: urlMap.get(photo.storage_path) ?? null,
  }));

  // Sign video URLs
  const vidPaths = (rawVideos ?? []).map(v => v.storage_path);
  const { data: vidSigned } = vidPaths.length > 0
    ? await supabase.storage.from("listing-videos").createSignedUrls(vidPaths, 7200)
    : { data: [] };
  const vidUrlMap = new Map((vidSigned ?? []).map(d => [d.path, d.signedUrl]));
  const videos = (rawVideos ?? []).map(v => ({
    ...v,
    url: vidUrlMap.get(v.storage_path) ?? null,
  }));

  const broker = {
    name:
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
      "Broker",
    brokerage: brokerDetails?.brokerage_name ?? null,
    phone: (profile as any)?.phone ?? null,
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
    />
  );
}
