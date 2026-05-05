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

  const paths = (photos ?? []).map(p => p.storage_path);
  const { data: signedData } = paths.length > 0
    ? await supabase.storage.from("listing-photos").createSignedUrls(paths, 3600)
    : { data: [] };
  const urlMap = new Map((signedData ?? []).map(d => [d.path, d.signedUrl]));
  const photosWithUrls = (photos ?? []).map(photo => ({
    ...photo,
    url: urlMap.get(photo.storage_path) ?? null,
  }));

  const { data: videos } = await supabase
    .from("videos")
    .select("id, storage_path, filename, created_at")
    .eq("listing_id", params.id)
    .order("created_at");
  const vidPaths = (videos ?? []).map(v => v.storage_path);
  const { data: vidSigned } = vidPaths.length > 0
    ? await supabase.storage.from("listing-videos").createSignedUrls(vidPaths, 3600)
    : { data: [] };
  const vidUrlMap = new Map((vidSigned ?? []).map(d => [d.path, d.signedUrl]));
  const videosWithUrls = (videos ?? []).map(v => ({
    ...v,
    url: vidUrlMap.get(v.storage_path) ?? null,
  }));

  return <AdminListingDetail listing={listing as any} photos={photosWithUrls} videos={videosWithUrls} />;
}
