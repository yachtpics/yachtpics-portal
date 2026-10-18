import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import GallerySlideshow from "./_components/GallerySlideshow";
import { withVideoPosters, withVideoUrls } from "@/lib/videoUrls";

type GalleryContact = { name: string; email: string | null; phone: string | null };

/** Quiet full-page note for a gallery that can't be shown. */
function GalleryUnavailable({ message, contact }: { message: string; contact: GalleryContact }) {
  return (
    <div className="min-h-screen bg-ink-50 flex items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <p className="label-caps text-accent-700">{contact.name}</p>
        <p className="text-ink-500 text-sm mt-3">{message}</p>
        {(contact.email || contact.phone) && (
          <p className="text-ink-500 text-sm mt-4">
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="text-accent-700 hover:text-accent-600 transition-colors duration-fast">{contact.email}</a>
            )}
            {contact.email && contact.phone && <span className="text-ink-300"> · </span>}
            {contact.phone && (
              <a href={`tel:${contact.phone.replace(/[^0-9+]/g, "")}`} className="text-accent-700 hover:text-accent-600 transition-colors duration-fast">{contact.phone}</a>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GallerySlideshowPage({ params }: { params: { slug: string } }) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: gallery } = await supabase
    .from("galleries")
    .select("id, title, slug, slideshow_published, downloads_enabled, expires_at, created_by")
    .eq("slug", params.slug)
    .maybeSingle();

  if (!gallery) notFound();

  // Who to contact about this gallery: the person who made it. Galleries are
  // made by YachtPics staff today, so an admin creator reads "Charlie at
  // YachtPics" with the studio email as a fallback; a broker reads as themself.
  let contact: GalleryContact = { name: "YachtPics", email: "hello@yachtpics.com", phone: null };
  if (gallery.created_by) {
    const { data: creator } = await supabase
      .from("profiles")
      .select("role, first_name, last_name, display_email, phone")
      .eq("id", gallery.created_by)
      .maybeSingle();
    if (creator) {
      const fullName = [creator.first_name, creator.last_name].filter(Boolean).join(" ").trim();
      if (creator.role === "admin") {
        contact = {
          name: creator.first_name ? `${creator.first_name} at YachtPics` : "YachtPics",
          email: creator.display_email ?? "hello@yachtpics.com",
          phone: creator.phone ?? null,
        };
      } else if (fullName) {
        contact = { name: fullName, email: creator.display_email ?? null, phone: creator.phone ?? null };
      }
    }
  }

  // Unpublished = taken down on purpose: fully blocked, viewing included.
  if (!gallery.slideshow_published) {
    return <GalleryUnavailable contact={contact} message={`This gallery is no longer available. Please contact ${contact.name} if you need anything from it.`} />;
  }

  // The time limit closes DOWNLOADS only — the slideshow stays viewable, as
  // the client gallery pages promise ("Downloads closed — slideshow still
  // available"). The download routes enforce the same limit server-side.
  const isExpired = gallery.expires_at != null && new Date(gallery.expires_at) <= new Date();
  const downloadsEnabled = !isExpired && gallery.downloads_enabled === true;

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
    .select("id, storage_path, storage_host, filename, created_at, thumbnail_path")
    .eq("gallery_id", gallery.id)
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("created_at");
  const [videoUrls, videoPosters] = await Promise.all([
    withVideoUrls(supabase, videos ?? [], { expiresIn: 7200 }),
    withVideoPosters(supabase, videos ?? [], { expiresIn: 7200 }),
  ]);
  const videoSlides = videoUrls
    .map((v, i) => ({ url: v.url, filename: v.filename ?? null, posterUrl: videoPosters[i]?.posterUrl ?? null }))
    .filter((s): s is { url: string; filename: string | null; posterUrl: string | null } => !!s.url);

  return (
    <GallerySlideshow
      slug={gallery.slug}
      title={gallery.title}
      photos={photoSlides}
      videos={videoSlides}
      downloadsEnabled={downloadsEnabled}
      downloadsClosedNote={isExpired ? `Downloads for this gallery have closed. Contact ${contact.name} for files.` : null}
      contact={contact}
    />
  );
}
