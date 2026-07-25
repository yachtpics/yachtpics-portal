import { createClient as createServiceClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import GalleryDetail from "./_components/GalleryDetail";

export const dynamic = "force-dynamic";

export default async function AdminGalleryDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: gallery } = await supabase
    .from("galleries")
    .select("id, title, gallery_type, slug, expires_at, slideshow_published, downloads_enabled, created_at")
    .eq("id", params.id)
    .single();

  if (!gallery) notFound();

  // Photos
  const { data: photos } = await supabase
    .from("photos")
    .select("id, storage_path, filename, category, display_order, is_visible")
    .eq("gallery_id", params.id)
    .order("display_order");
  const photoPaths = (photos ?? []).map((p) => p.storage_path);
  const { data: photoSigned } = photoPaths.length > 0
    ? await supabase.storage.from("listing-photos").createSignedUrls(photoPaths, 3600)
    : { data: [] };
  const photoUrlMap = new Map((photoSigned ?? []).map((d) => [d.path, d.signedUrl]));
  const photosWithUrls = (photos ?? []).map((p) => ({ ...p, url: photoUrlMap.get(p.storage_path) ?? null }));

  // Videos
  const { data: videos } = await supabase
    .from("videos")
    .select("id, storage_path, filename, created_at")
    .eq("gallery_id", params.id)
    .order("created_at");
  const vidPaths = (videos ?? []).map((v) => v.storage_path);
  const { data: vidSigned } = vidPaths.length > 0
    ? await supabase.storage.from("listing-videos").createSignedUrls(vidPaths, 3600)
    : { data: [] };
  const vidUrlMap = new Map((vidSigned ?? []).map((d) => [d.path, d.signedUrl]));
  const videosWithUrls = (videos ?? []).map((v) => ({ ...v, url: vidUrlMap.get(v.storage_path) ?? null }));

  // Recipients + activity
  const [{ data: accessRows }, { data: views }, { data: downloads }, { data: opens }] = await Promise.all([
    supabase
      .from("gallery_access")
      .select("user_id, created_at, profiles:user_id(first_name, last_name, display_email)")
      .eq("gallery_id", params.id),
    supabase.from("gallery_views").select("id").eq("gallery_id", params.id),
    supabase.from("gallery_downloads").select("user_id, item_count, kind, downloaded_at").eq("gallery_id", params.id).order("downloaded_at", { ascending: false }),
    supabase.from("gallery_opens").select("user_id, opened_at").eq("gallery_id", params.id).order("opened_at", { ascending: false }),
  ]);

  const downloadEvents = downloads ?? [];
  const openRows = opens ?? [];

  // Per-recipient rollups
  const opensByUser = new Map<string, { count: number; last: string }>();
  for (const o of openRows) {
    const uid = o.user_id as string;
    const cur = opensByUser.get(uid);
    if (cur) cur.count += 1;
    else opensByUser.set(uid, { count: 1, last: o.opened_at as string }); // rows are desc, first seen = latest
  }
  const dlByUser = new Map<string, { files: number; sessions: number; last: string }>();
  for (const d of downloadEvents) {
    const uid = d.user_id as string;
    if (!uid) continue;
    const cur = dlByUser.get(uid);
    if (cur) { cur.files += d.item_count ?? 0; cur.sessions += 1; }
    else dlByUser.set(uid, { files: d.item_count ?? 0, sessions: 1, last: d.downloaded_at as string });
  }

  const recipients = (accessRows ?? []).map((r) => {
    const p = (r.profiles as unknown) as { first_name: string | null; last_name: string | null; display_email: string | null } | null;
    const uid = r.user_id as string;
    const op = opensByUser.get(uid);
    const dl = dlByUser.get(uid);
    return {
      userId: uid,
      name: p?.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : null,
      email: p?.display_email ?? null,
      lastOpenedAt: op?.last ?? null,
      openCount: op?.count ?? 0,
      filesDownloaded: dl?.files ?? 0,
      lastDownloadAt: dl?.last ?? null,
    };
  });

  const viewCount = (views ?? []).length;
  const downloadItemTotal = downloadEvents.reduce((s, d) => s + (d.item_count ?? 0), 0);
  const lastDownloadAt = downloadEvents[0]?.downloaded_at ?? null;
  const openedRecipients = recipients.filter((r) => r.openCount > 0).length;

  return (
    <GalleryDetail
      gallery={gallery}
      photos={photosWithUrls}
      videos={videosWithUrls}
      recipients={recipients}
      metrics={{
        views: viewCount,
        downloadEvents: downloadEvents.length,
        downloadItems: downloadItemTotal,
        lastDownloadAt,
        openedRecipients,
        totalRecipients: recipients.length,
      }}
    />
  );
}
