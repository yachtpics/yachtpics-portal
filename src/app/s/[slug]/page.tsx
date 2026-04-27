import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import SlideshowViewer from "./SlideshowViewer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublicSlideshowPage({
  params,
}: {
  params: { slug: string };
}) {
  // Force headers() call so Next.js treats this as fully dynamic (no static optimization)
  headers();

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

  const [{ data: profile }, { data: photos }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", listing.broker_id)
        .single(),
      supabase
        .from("photos")
        .select("id, storage_path, category, filename, display_order")
        .eq("listing_id", listing.id)
        .eq("is_visible", true)
        .order("display_order"),
    ]);

  // Separate query to avoid any caching of old broken query
  const { data: brokerDetails } = await supabase
    .from("broker_details")
    .select("brokerage_name, phone, website, logo_url")
    .eq("id", listing.broker_id)
    .maybeSingle();

  const withUrls = await Promise.all(
    (photos ?? []).map(async (photo) => {
      const { data } = await supabase.storage
        .from("listing-photos")
        .createSignedUrl(photo.storage_path, 7200);
      return { ...photo, url: data?.signedUrl ?? null };
    })
  );

  const broker = {
    name:
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
      "Broker",
    brokerage: brokerDetails?.brokerage_name ?? null,
    phone: brokerDetails?.phone ?? null,
    website: brokerDetails?.website ?? null,
    logoUrl: brokerDetails?.logo_url ?? null,
  };

  return <SlideshowViewer listing={listing} broker={broker} photos={withUrls} />;
}
