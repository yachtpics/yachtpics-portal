import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import GallerySlideshow from "./_components/GallerySlideshow";
import { serviceClient } from "@/lib/publicSlideshow";
import { GALLERY_TTL, getGalleryBySlug, loadGalleryMedia, type PublicGallery } from "@/lib/publicGallery";
import { OG_TRANSFORM, signOneTransformed } from "@/lib/publicPhotoUrls";

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

const NEUTRAL_METADATA: Metadata = {
  title: "YachtPics Portal",
  description: "Yacht photography presented by YachtPics.",
};
const OG_TTL = 60 * 60 * 24 * 7;

/**
 * Who to contact about this gallery: the person who made it. Galleries are
 * made by YachtPics staff today, so an admin creator reads "Charlie at
 * YachtPics" with the studio email as a fallback; a broker reads as themself.
 */
async function galleryContact(supabase: SupabaseClient, gallery: PublicGallery): Promise<GalleryContact> {
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
  return contact;
}

/** Full-size originals for the visible photos, keyed by storage path (download fallback). */
async function signGalleryOriginals(supabase: SupabaseClient, galleryId: string): Promise<Map<string, string | null>> {
  const { data: photos } = await supabase
    .from("photos")
    .select("storage_path")
    .eq("gallery_id", galleryId)
    .eq("is_visible", true);
  const paths = (photos ?? []).map((p) => p.storage_path as string);
  if (paths.length === 0) return new Map();
  const { data: signed } = await supabase.storage.from("listing-photos").createSignedUrls(paths, GALLERY_TTL);
  return new Map((signed ?? []).map((d) => [d.path ?? "", d.signedUrl]));
}

/** Rich link preview: gallery title, who it's from, first photo as the card. */
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  try {
    const gallery = await getGalleryBySlug(params.slug);
    if (!gallery || !gallery.slideshow_published) return NEUTRAL_METADATA;
    const supabase = serviceClient();
    const [contact, { data: first }] = await Promise.all([
      galleryContact(supabase, gallery),
      supabase
        .from("photos")
        .select("storage_path")
        .eq("gallery_id", gallery.id)
        .eq("is_visible", true)
        .order("display_order")
        .limit(1)
        .maybeSingle(),
    ]);
    const image = first?.storage_path
      ? await signOneTransformed(supabase, first.storage_path, OG_TRANSFORM, OG_TTL)
      : null;
    const title = gallery.title || "Photo gallery";
    const description = `Photo gallery presented by ${contact.name}.`;
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        siteName: "YachtPics Portal",
        ...(image ? { images: [{ url: image, width: OG_TRANSFORM.width, height: OG_TRANSFORM.height, alt: title }] } : {}),
      },
      twitter: {
        card: image ? "summary_large_image" : "summary",
        title,
        description,
        ...(image ? { images: [image] } : {}),
      },
    };
  } catch {
    return NEUTRAL_METADATA;
  }
}

export default async function GallerySlideshowPage({ params }: { params: { slug: string } }) {
  const supabase = serviceClient();

  const gallery = await getGalleryBySlug(params.slug);
  if (!gallery) notFound();

  const contact = await galleryContact(supabase, gallery);

  // Unpublished = taken down on purpose: fully blocked, viewing included.
  if (!gallery.slideshow_published) {
    return <GalleryUnavailable contact={contact} message={`This gallery is no longer available. Please contact ${contact.name} if you need anything from it.`} />;
  }

  // The time limit closes DOWNLOADS only — the slideshow stays viewable, as
  // the client gallery pages promise ("Downloads closed — slideshow still
  // available"). The download routes enforce the same limit server-side.
  const isExpired = gallery.expires_at != null && new Date(gallery.expires_at) <= new Date();
  const downloadsEnabled = !isExpired && gallery.downloads_enabled === true;

  // Display sizes for the slideshow (thumb for tiles, full for the main
  // slide). Originals are signed only when downloads are open — they're the
  // fallback if re-signing at download time fails.
  const [media, originals] = await Promise.all([
    loadGalleryMedia(supabase, gallery.id),
    downloadsEnabled ? signGalleryOriginals(supabase, gallery.id) : Promise.resolve(new Map<string, string | null>()),
  ]);
  const photoSlides = media.photos
    .map((p) => ({
      id: p.id,
      url: media.urls.photos[p.id]?.full ?? null,
      thumbUrl: media.urls.photos[p.id]?.thumb ?? null,
      downloadUrl: originals.get(p.storage_path) ?? null,
      category: p.category,
    }))
    .filter((s): s is { id: string; url: string; thumbUrl: string | null; downloadUrl: string | null; category: string | null } => !!s.url);

  const videoSlides = media.videos
    .map((v) => ({
      id: v.id,
      url: media.urls.videos[v.id]?.url ?? null,
      filename: v.filename ?? null,
      posterUrl: media.urls.videos[v.id]?.posterUrl ?? null,
    }))
    .filter((s): s is { id: string; url: string; filename: string | null; posterUrl: string | null } => !!s.url);

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
