import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import GallerySlideshow from "./_components/GallerySlideshow";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GallerySlideshowPage({ params }: { params: { slug: string } }) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: gallery } = await supabase
    .from("galleries")
    .select("id, title, slug, slideshow_published")
    .eq("slug", params.slug)
    .maybeSingle();

  if (!gallery || !gallery.slideshow_published) notFound();

  const { data: photos } = await supabase
    .from("photos")
    .select("storage_path, category, display_order")
    .eq("gallery_id", gallery.id)
    .eq("is_visible", true)
    .order("display_order");
  const paths = (photos ?? []).map((p) => p.storage_path);
  const { data: signed } = paths.length > 0
    ? await supabase.storage.from("listing-photos").createSignedUrls(paths, 7200)
    : { data: [] };
  const pmap = new Map((signed ?? []).map((d) => [d.path, d.signedUrl]));
  const photoSlides = (photos ?? [])
    .map((p) => ({ url: pmap.get(p.storage_path) ?? null, category: p.category }))
    .filter((s): s is { url: string; category: string | null } => !!s.url);

  const { data: videos } = await supabase
    .from("videos")
    .select("storage_path, filename, created_at")
    .eq("gallery_id", gallery.id)
    .order("created_at");
  const vpaths = (videos ?? []).map((v) => v.storage_path);
  const { data: vsigned } = vpaths.length > 0
    ? await supabase.storage.from("listing-videos").createSignedUrls(vpaths, 7200)
    : { data: [] };
  const vmap = new Map((vsigned ?? []).map((d) => [d.path, d.signedUrl]));
  const videoSlides = (videos ?? [])
    .map((v) => ({ url: vmap.get(v.storage_path) ?? null, filename: v.filename }))
    .filter((s): s is { url: string; filename: string | null } => !!s.url);

  return <GallerySlideshow slug={gallery.slug} title={gallery.title} photos={photoSlides} videos={videoSlides} />;
}
