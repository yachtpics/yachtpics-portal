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
    .select("id, title, slug, slideshow_published, downloads_enabled, expires_at")
    .eq("slug", params.slug)
    .maybeSingle();

  if (!gallery || !gallery.slideshow_published) notFound();

  // The time limit governs the whole link: once it passes, the gallery stops
  // working — viewing and downloads alike. Show a friendly note rather than a
  // raw 404 so a recipient with an old link understands what happened.
  const isExpired = gallery.expires_at != null && new Date(gallery.expires_at) <= new Date();
  if (isExpired) {
    return (
      <div className="min-h-screen bg-ink-50 flex items-center justify-center px-6 text-center">
        <div>
          <p className="label-caps text-accent-700">YachtPics</p>
          <p className="text-ink-500 text-sm mt-3">This gallery link has expired and is no longer available.</p>
        </div>
      </div>
    );
  }

  // Downloads additionally require the switch to be on (the gallery is already
  // known to be within its time limit here).
  const downloadsEnabled = gallery.downloads_enabled === true;

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

  return <GallerySlideshow slug={gallery.slug} title={gallery.title} photos={photoSlides} videos={videoSlides} downloadsEnabled={downloadsEnabled} />;
}
