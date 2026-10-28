import { requireAdminPage } from "@/lib/requireAdminPage";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import GalleryDetail from "./_components/GalleryDetail";
import RefreshOnMount from "@/components/RefreshOnMount";
import { withVideoUrls } from "@/lib/videoUrls";
import { signDerivatives } from "@/lib/photoDerivatives";
import { signOriginalPaths } from "@/lib/photoStore";

export const dynamic = "force-dynamic";

export default async function AdminGalleryDetailPage({ params }: { params: { id: string } }) {
  // Role check lives in the page, not only the layout — see requireAdminPage.
  await requireAdminPage();
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
    .select("id, storage_path, filename, category, display_order, is_visible, derivatives_at")
    .eq("gallery_id", params.id)
    .order("display_order");
  // Grid tiles use the stored 600px WebP copy (~30 KB) — signing the originals
  // made a 239-photo gallery pull hundreds of MB. Photos without derivatives yet
  // (just uploaded, or unresizable) fall back to their original.
  const { urls: thumbUrls, missing: noThumb } = await signDerivatives(supabase, photos ?? [], 600, 3600);
  const fallbackPaths = noThumb.map((p) => p.storage_path).filter(Boolean);
  const { data: photoSigned } = fallbackPaths.length > 0
    ? { data: await signOriginalPaths(supabase, fallbackPaths, 3600) }
    : { data: [] };
  const photoUrlMap = new Map((photoSigned ?? []).map((d) => [d.path, d.signedUrl]));
  const photosWithUrls = (photos ?? []).map((p) => ({
    ...p,
    url: thumbUrls[p.id] ?? photoUrlMap.get(p.storage_path) ?? null,
  }));
  // Still waiting for thumbnails (null — not the "unavailable" marker):
  // GalleryDetail starts making them in the background when this is > 0.
  const pendingThumbs = (photos ?? []).filter((p) => !p.derivatives_at).length;

  // Videos
  const { data: videos } = await supabase
    .from("videos")
    .select("id, storage_path, storage_host, filename, created_at")
    .eq("gallery_id", params.id)
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("created_at");
  const videosWithUrls = await withVideoUrls(supabase, videos ?? [], { expiresIn: 3600 });

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
    <>
      <RefreshOnMount />
      <GalleryDetail
        gallery={gallery}
        photos={photosWithUrls}
        pendingThumbs={pendingThumbs}
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
    </>
  );
}
