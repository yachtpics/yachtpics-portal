import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { signVideoUrls } from "@/lib/videoUrls";

export const runtime = "nodejs";

/**
 * POST /api/g/[slug]/signed-urls
 *   → fresh signed URLs for a PUBLIC gallery's photos and videos.
 *
 * The public slideshow signs every URL once, when the page renders. Those links
 * expire, and an expired Supabase link doesn't fail loudly — it returns a small
 * error document. Saved with a .jpg name that becomes a file the visitor's
 * computer refuses to open, and inside a zip it silently goes missing. So the
 * download path re-signs immediately before it runs.
 *
 * No login here by design, but the gallery must genuinely be published, have
 * downloads switched on, and be inside its time limit — the same conditions the
 * download button itself is gated on. Without those checks this would be an
 * open door to any gallery's files.
 */
export async function POST(_req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: gallery } = await supabase
      .from("galleries")
      .select("id, slideshow_published, downloads_enabled, expires_at")
      .eq("slug", params.slug)
      .maybeSingle();

    const open =
      gallery?.slideshow_published &&
      gallery.downloads_enabled === true &&
      (!gallery.expires_at || new Date(gallery.expires_at) > new Date());
    if (!gallery || !open) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: photos } = await supabase
      .from("photos")
      .select("storage_path, display_order, created_at")
      .eq("gallery_id", gallery.id)
      .eq("is_visible", true)
      .order("display_order");
    const { data: videos } = await supabase
      .from("videos")
      .select("id, storage_path, storage_host, created_at")
      .eq("gallery_id", gallery.id)
      .order("created_at");

    // Six hours — longer than any realistic download session, well short of
    // outliving the gallery.
    const TTL = 60 * 60 * 6;

    const photoPaths = (photos ?? []).map((p) => p.storage_path);
    const { data: ps } = photoPaths.length
      ? await supabase.storage.from("listing-photos").createSignedUrls(photoPaths, TTL)
      : { data: [] };

    const vmap = await signVideoUrls(supabase, videos ?? [], { expiresIn: TTL });

    // Returned in the same order the slideshow renders them, so the client can
    // line them up by index without needing ids it doesn't have.
    return NextResponse.json({
      photos: (photos ?? []).map((p) => (ps ?? []).find((d) => d.path === p.storage_path)?.signedUrl ?? null),
      videos: (videos ?? []).map((v) => vmap.get(v.id) ?? null),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
