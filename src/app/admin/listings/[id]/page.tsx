import { requireAdminPage } from "@/lib/requireAdminPage";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import AdminListingDetail from "./_components/AdminListingDetail";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import { withVideoUrls } from "@/lib/videoUrls";

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

export default async function AdminListingPage({ params, searchParams }: { params: { id: string }; searchParams: { from?: string } }) {
  // Role check lives in the page, not only the layout — see requireAdminPage.
  await requireAdminPage();
  const supabase = await createClient();
  const serviceSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Every category in use across all listings, for the dropdown. Prefers the
  // distinct_photo_categories() function (a handful of rows) over reading the
  // category of every photo in the library. Until that migration
  // (supabase/migrations/20260923_distinct_photo_categories.sql) is applied the
  // rpc errors, and this falls back to the original query unchanged.
  const loadUsedCategories = async (): Promise<{ data: { category: string | null }[] | null }> => {
    const { data, error } = await supabase.rpc("distinct_photo_categories");
    if (!error) return { data: (data ?? []) as { category: string | null }[] };
    const { data: rows } = await supabase
      .from("photos")
      .select("category")
      .not("category", "is", null);
    return { data: rows as { category: string | null }[] | null };
  };

  // Every read below depends only on the listing id from the URL, so they all
  // go out together in one wave. This page used to await them one after
  // another — about fifteen round trips to Supabase stacked end to end before
  // anything could render. Now it's two waves: the table reads, then the
  // three things that genuinely need a wave-one result (the pocket-listing
  // setter's name, and signing the photo and video urls).
  const [
    { data: listing },
    // The website's brokerage pages — 25 years of them. Drives the "publish to
    // which page?" picker. Deliberately not derived from brokerages: most brokers
    // have no brokerage record, and the filenames have quirks no slug rule would
    // guess (HMY Yacht Sales → brokerage_boats).
    { data: sitePages },
    // Co-brokers: all brokers (for the picker) + who's already attached.
    { data: allBrokers },
    { data: leadRows },
    { data: coBrokerRows },
    { data: photos },
    { data: videos },
    // Collect all non-standard categories used across every listing so they're
    // available in the dropdown on any listing page
    { data: allCatRows },
    // Saved custom categories (from the Photo Categories admin page) — these should
    // appear in the dropdown even before any photo uses them.
    { data: savedCustomRows },
    // Photo download history for this listing
    { data: downloadRows },
    // External downloads via public download links (no portal login)
    { data: linkDownloadRows },
    // Emails the system has sent for this listing
    { data: sentEmailRows },
  ] = await Promise.all([
    supabase
      .from("listings")
      .select(`
      id, vessel_name, vessel_type, year, length_ft, make, model,
      asking_price, location, description, status, listing_pdf_url, is_shared, in_showcase, showcase_opt_out, showcase_opt_out_by, showcase_opt_out_at, publish_to_site, site_page, site_media,
      broker_id, slideshow_slug, slideshow_published, hero_photo_id, photo_order_manual,
      profiles:broker_id(first_name, last_name, display_email, brokerage_id)
    `)
      .eq("id", params.id)
      .single(),
    supabase
      .from("site_pages")
      .select("label, filename")
      .eq("is_active", true)
      .order("label"),
    serviceSupabase
      .from("profiles")
      .select("id, first_name, last_name, display_email")
      .eq("role", "broker")
      .order("last_name", { ascending: true }),
    serviceSupabase
      .from("listing_leads")
      .select("id, name, email, phone, message, status, created_at")
      .eq("listing_id", params.id)
      .order("created_at", { ascending: false }),
    serviceSupabase
      .from("listing_co_brokers")
      .select("broker_id, profiles:broker_id(first_name, last_name, display_email)")
      .eq("listing_id", params.id),
    supabase
      .from("photos")
      .select("id, storage_path, filename, category, display_order, is_visible")
      .eq("listing_id", params.id)
      .order("display_order"),
    supabase
      .from("videos")
      .select("id, storage_path, storage_host, filename, created_at, in_slideshow, display_order, title, description")
      .eq("listing_id", params.id)
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("created_at"),
    loadUsedCategories(),
    supabase
      .from("custom_photo_categories")
      .select("name"),
    supabase
      .from("photo_downloads")
      .select("id, photo_count, downloaded_at, profiles:downloaded_by(first_name, last_name, display_email)")
      .eq("listing_id", params.id)
      .order("downloaded_at", { ascending: false })
      .limit(20),
    serviceSupabase
      .from("download_link_downloads")
      .select("id, photo_count, downloaded_at, download_links(label)")
      .eq("listing_id", params.id)
      .order("downloaded_at", { ascending: false })
      .limit(20),
    serviceSupabase
      .from("email_log")
      .select("id, sent_at, email_type, recipient_email, recipient_role, status")
      .eq("listing_id", params.id)
      .order("sent_at", { ascending: false })
      .limit(50),
  ]);

  if (!listing) notFound();

  // Who made it a pocket listing. The admin page can now set that flag itself,
  // so "the broker asked for this" stopped being safe to assume — and it is
  // the only thing that tells you whether turning it off is housekeeping or
  // overriding a client's privacy instruction.
  //
  // A null setter on a listing that IS opted out means the broker: every such
  // row predates the admin switch, when only their side could set it.
  const loadPocketSetBy = async (): Promise<string | null> => {
    if (!(listing as { showcase_opt_out?: boolean | null }).showcase_opt_out) return null;
    const setterId = (listing as { showcase_opt_out_by?: string | null }).showcase_opt_out_by ?? null;
    if (!setterId) return "the broker";
    const { data: setter } = await serviceSupabase
      .from("profiles")
      .select("first_name, last_name, display_email, role")
      .eq("id", setterId)
      .maybeSingle();
    const name = setter?.first_name
      ? `${setter.first_name} ${setter.last_name ?? ""}`.trim()
      : setter?.display_email ?? "someone";
    return setter?.role === "admin" ? `${name} (YachtPics)` : name;
  };

  const paths = (photos ?? []).map(p => p.storage_path);
  const signPhotos = async () => {
    if (paths.length === 0) return [];
    const { data } = await supabase.storage.from("listing-photos").createSignedUrls(paths, 3600);
    return data;
  };

  // Wave 2 — the reads that needed a wave-one result, side by side.
  const [pocketSetBy, signedData, videosWithUrls] = await Promise.all([
    loadPocketSetBy(),
    signPhotos(),
    withVideoUrls(supabase, videos ?? [], { expiresIn: 3600 }),
  ]);

  // Only boats whose broker belongs to a brokerage can be shared into one.
  const ownerBrokerageId = (listing.profiles as unknown as { brokerage_id: string | null } | null)?.brokerage_id ?? null;

  const brokerOptions = (allBrokers ?? [])
    .filter((b) => b.id !== listing.broker_id)
    .map((b) => ({ id: b.id as string, name: b.first_name ? `${b.first_name} ${b.last_name ?? ""}`.trim() : (b.display_email ?? "Broker") }));

  const leads = (leadRows ?? []) as { id: string; name: string | null; email: string | null; phone: string | null; message: string | null; status: string; created_at: string }[];

  const coBrokers = (coBrokerRows ?? []).map((r) => {
    const p = r.profiles as unknown as { first_name: string | null; last_name: string | null; display_email: string | null } | null;
    return { id: r.broker_id as string, name: p?.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : (p?.display_email ?? "Broker") };
  });

  const urlMap = new Map((signedData ?? []).map(d => [d.path, d.signedUrl]));
  const photosWithUrls = (photos ?? []).map(photo => ({
    ...photo,
    url: urlMap.get(photo.storage_path) ?? null,
  }));

  const globalCustomCategories = Array.from(
    new Set(
      [
        ...(allCatRows ?? []).map((r) => r.category as string),
        ...(savedCustomRows ?? []).map((r) => r.name as string),
      ].filter((c) => c && !(PHOTO_CATEGORIES as readonly string[]).includes(c))
    )
  ).sort((a, b) => a.localeCompare(b));

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
      sitePages={sitePages ?? []}
      coBrokers={coBrokers}
      leads={leads}
      fromBroker={searchParams?.from === "broker"}
      pocketSetBy={pocketSetBy}
    />
  );
}
