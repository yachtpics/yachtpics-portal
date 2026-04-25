import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import AdminListingDetail from "./_components/AdminListingDetail";

export default async function AdminListingPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();

  const { data: listing } = await supabase
    .from("listings")
    .select(`
      id, vessel_name, vessel_type, year, length_ft, make, model,
      asking_price, location, description, status, listing_pdf_url,
      broker_id,
      profiles:broker_id(first_name, last_name, display_email)
    `)
    .eq("id", params.id)
    .single();

  if (!listing) notFound();

  const { data: photos } = await supabase
    .from("photos")
    .select("id, storage_path, filename, category, display_order, is_visible")
    .eq("listing_id", params.id)
    .order("display_order");

  // Get signed URLs for all photos
  const photosWithUrls = await Promise.all(
    (photos ?? []).map(async (photo) => {
      const { data } = await supabase.storage
        .from("listing-photos")
        .createSignedUrl(photo.storage_path, 3600);
      return { ...photo, url: data?.signedUrl ?? null };
    })
  );

  return <AdminListingDetail listing={listing as any} photos={photosWithUrls} />;
}
