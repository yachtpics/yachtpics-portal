import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import AdminListingDetail from "./_components/AdminListingDetail";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";

type DownloadProfile = { first_name: string | null; last_name: string | null; display_email: string | null };
type DownloadRecord = {
  id: string;
  photo_count: number;
  downloaded_at: string;
  downloader_name: string;
  downloader_email: string | null;
};

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

  // Collect all non-standard categories used across every listing so they're
  // available in the dropdown on any listing page
  const { data: allCatRows } = await supabase
    .from("photos")
    .select("category")
    .not("category", "is", null);
  // Saved custom categories (from the Photo Categories admin page) — these should
  // appear in the dropdown even before any photo uses them.
  const { data: savedCustomRows } = await supabase
    .from("custom_photo_categories")
    .select("name");
  const globalCustomCategories = Array.from(
    new Set(
      [
        ...(allCatRows ?? []).map((r) => r.category as string),
        ...(savedCustomRows ?? []).map((r) => r.name as string),
      ].filter((c) => c && !(PHOTO_CATEGORIES as readonly string[]).includes(c))
    )
  ).sort((a, b) => a.localeCompare(b));

  // Photo download history for this listing
  const { data: downloadRows } = await supabase
    .from("photo_downloads")
    .select("id, photo_count, downloaded_at, profiles:downloaded_by(first_name, last_name, display_email)")
    .eq("listing_id", params.id)
    .order("downloaded_at", { ascending: false })
    .limit(20);

  const downloads: DownloadRecord[] = (downloadRows ?? []).map((r) => {
    const p = (r.profiles as unknown) as DownloadProfile | null;
    return {
      id: r.id,
      photo_count: r.photo_count,
      downloaded_at: r.downloaded_at,
      downloader_name: p?.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : "Unknown",
      downloader_email: p?.display_email ?? null,
    };
  });

  return (
    <AdminListingDetail
      listing={listing as any}
      photos={photosWithUrls}
      videos={videosWithUrls}
      globalCustomCategories={globalCustomCategories}
      downloads={downloads}
    />
  );
}
