import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import ClientGalleryView from "./_components/ClientGalleryView";
import { withVideoUrls } from "@/lib/videoUrls";

export const dynamic = "force-dynamic";

export default async function ClientGalleryPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Verify this client has access to this gallery
  const { data: access } = await service
    .from("gallery_access")
    .select("id")
    .eq("gallery_id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!access) notFound();

  const { data: gallery } = await service
    .from("galleries")
    .select("id, title, slug, expires_at, slideshow_published")
    .eq("id", params.id)
    .single();
  if (!gallery) notFound();

  const { data: photos } = await service
    .from("photos")
    .select("id, storage_path, filename, category, display_order, is_visible, uploaded_by")
    .eq("gallery_id", params.id)
    .order("display_order");
  const photoPaths = (photos ?? []).map((p) => p.storage_path);
  const { data: ps } = photoPaths.length > 0
    ? await service.storage.from("listing-photos").createSignedUrls(photoPaths, 7200)
    : { data: [] };
  const pmap = new Map((ps ?? []).map((d) => [d.path, d.signedUrl]));
  const photosWithUrls = (photos ?? []).map((p) => ({
    id: p.id,
    filename: p.filename,
    category: p.category,
    is_visible: p.is_visible,
    url: pmap.get(p.storage_path) ?? null,
  }));

  const { data: videos } = await service
    .from("videos")
    .select("id, storage_path, storage_host, filename, created_at, uploaded_by")
    .eq("gallery_id", params.id)
    .order("created_at");

  // Only claim YachtPics ownership in the footer when ALL media is ours
  // (delivered/no uploader, or uploaded by an admin) — not broker uploads.
  const uploaderIds = Array.from(new Set([
    ...(photos ?? []).map((p) => p.uploaded_by),
    ...(videos ?? []).map((v) => v.uploaded_by),
  ].filter(Boolean) as string[]));
  let mediaByYachtPics = true;
  if (uploaderIds.length > 0) {
    const { data: uploaders } = await service.from("profiles").select("id, role").in("id", uploaderIds);
    const adminIds = new Set((uploaders ?? []).filter((u) => u.role === "admin").map((u) => u.id));
    mediaByYachtPics = uploaderIds.every((id) => adminIds.has(id));
  }
  // Signed by whichever store actually holds each file — Supabase or the
  // private Cloudflare bucket — so this page doesn't care where the migration
  // has got to.
  const videosWithUrls = (await withVideoUrls(service, videos ?? [], { expiresIn: 7200 }))
    .map((v) => ({ id: v.id, filename: v.filename, url: v.url }));

  const expired = gallery.expires_at ? new Date(gallery.expires_at).getTime() < Date.now() : false;
  const slideshowUrl = gallery.slideshow_published ? `https://portal.yachtpics.com/g/${gallery.slug}` : null;

  return (
    <ClientGalleryView
      galleryId={gallery.id}
      title={gallery.title}
      photos={photosWithUrls}
      videos={videosWithUrls}
      expired={expired}
      expiresAt={gallery.expires_at}
      slideshowUrl={slideshowUrl}
      mediaByYachtPics={mediaByYachtPics}
    />
  );
}
