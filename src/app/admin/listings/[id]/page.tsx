import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
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
  source: "portal" | "link";
};
type SentEmail = {
  id: string;
  sent_at: string;
  email_type: string;
  recipient_email: string;
  recipient_role: string | null;
  status: string;
};

export default async function AdminListingPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const serviceSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: listing } = await supabase
    .from("listings")
    .select(`
      id, vessel_name, vessel_type, year, length_ft, make, model,
      asking_price, location, description, status, listing_pdf_url, is_shared,
      broker_id, slideshow_slug, slideshow_published,
      profiles:broker_id(first_name, last_name, display_email, brokerage_id)
    `)
    .eq("id", params.id)
    .single();

  if (!listing) notFound();

  // Only boats whose broker belongs to a brokerage can be shared into one.
  const ownerBrokerageId = (listing.profiles as unknown as { brokerage_id: string | null } | null)?.brokerage_id ?? null;

  // Co-brokers: all brokers (for the picker) + who's already attached.
  const { data: allBrokers } = await serviceSupabase
    .from("profiles")
    .select("id, first_name, last_name, display_email")
    .eq("role", "broker")
    .order("last_name", { ascending: true });
  const brokerOptions = (allBrokers ?? [])
    .filter((b) => b.id !== listing.broker_id)
    .map((b) => ({ id: b.id as string, name: b.first_name ? `${b.first_name} ${b.last_name ?? ""}`.trim() : (b.display_email ?? "Broker") }));

  const { data: leadRows } = await serviceSupabase
    .from("listing_leads")
    .select("id, name, email, phone, message, status, created_at")
    .eq("listing_id", params.id)
    .order("created_at", { ascending: false });
  const leads = (leadRows ?? []) as { id: string; name: string | null; email: string | null; phone: string | null; message: string | null; status: string; created_at: string }[];

  const { data: coBrokerRows } = await serviceSupabase
    .from("listing_co_brokers")
    .select("broker_id, profiles:broker_id(first_name, last_name, display_email)")
    .eq("listing_id", params.id);
  const coBrokers = (coBrokerRows ?? []).map((r) => {
    const p = r.profiles as unknown as { first_name: string | null; last_name: string | null; display_email: string | null } | null;
    return { id: r.broker_id as string, name: p?.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : (p?.display_email ?? "Broker") };
  });

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

  const portalDownloads: DownloadRecord[] = (downloadRows ?? []).map((r) => {
    const p = (r.profiles as unknown) as DownloadProfile | null;
    return {
      id: r.id,
      photo_count: r.photo_count,
      downloaded_at: r.downloaded_at,
      downloader_name: p?.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : "Unknown",
      downloader_email: p?.display_email ?? null,
      source: "portal" as const,
    };
  });

  // External downloads via public download links (no portal login)
  const { data: linkDownloadRows } = await serviceSupabase
    .from("download_link_downloads")
    .select("id, photo_count, downloaded_at, download_links(label)")
    .eq("listing_id", params.id)
    .order("downloaded_at", { ascending: false })
    .limit(20);

  const linkDownloads: DownloadRecord[] = (linkDownloadRows ?? []).map((r) => {
    const dl = (r.download_links as unknown) as { label: string | null } | null;
    return {
      id: r.id,
      photo_count: r.photo_count,
      downloaded_at: r.downloaded_at,
      downloader_name: dl?.label ? dl.label : "Recipient",
      downloader_email: null,
      source: "link" as const,
    };
  });

  const downloads: DownloadRecord[] = [...portalDownloads, ...linkDownloads]
    .sort((a, b) => new Date(b.downloaded_at).getTime() - new Date(a.downloaded_at).getTime())
    .slice(0, 20);

  // Emails the system has sent for this listing
  const { data: sentEmailRows } = await serviceSupabase
    .from("email_log")
    .select("id, sent_at, email_type, recipient_email, recipient_role, status")
    .eq("listing_id", params.id)
    .order("sent_at", { ascending: false })
    .limit(50);
  const sentEmails = (sentEmailRows ?? []) as SentEmail[];

  return (
    <AdminListingDetail
      listing={listing as any}
      photos={photosWithUrls}
      videos={videosWithUrls}
      globalCustomCategories={globalCustomCategories}
      downloads={downloads}
      sentEmails={sentEmails}
      canShare={ownerBrokerageId != null}
      brokerOptions={brokerOptions}
      coBrokers={coBrokers}
      leads={leads}
    />
  );
}
