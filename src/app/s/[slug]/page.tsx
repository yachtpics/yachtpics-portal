import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import SlideshowViewer from "./SlideshowViewer";

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
    .select("id, vessel_name, vessel_type, year, length_ft, make, model, asking_price, location, broker_id")
    .eq("slideshow_slug", params.slug)
    .eq("slideshow_published", true)
    .single();

  if (!listing) notFound();

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
