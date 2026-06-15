import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import ClientGalleryView from "./_components/ClientGalleryView";

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
    .select("id, storage_path, filename, category, display_order")
    .eq("gallery_id", params.id)
    .eq("is_visible", true)
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
    url: pmap.get(p.storage_path) ?? null,
  }));

  const { data: videos } = await service
    .from("videos")
    .select("id, storage_path, filename, created_at")
    .eq("gallery_id", params.id)
    .order("created_at");
  const vidPaths = (videos ?? []).map((v) => v.storage_path);
  const { data: vs } = vidPaths.length > 0
    ? await service.storage.from("listing-videos").createSignedUrls(vidPaths, 7200)
    : { data: [] };
  const vmap = new Map((vs ?? []).map((d) => [d.path, d.signedUrl]));
  const videosWithUrls = (videos ?? []).map((v) => ({
    id: v.id,
    filename: v.filename,
    url: vmap.get(v.storage_path) ?? null,
  }));

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
    />
  );
}
