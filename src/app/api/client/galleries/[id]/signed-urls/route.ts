import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { signVideoUrls } from "@/lib/videoUrls";

export const runtime = "nodejs";

/**
 * POST /api/client/galleries/[id]/signed-urls
 *   → fresh signed URLs for this gallery's photos and videos.
 *
 * WHY THIS EXISTS: the gallery page signs every URL once, when the page renders.
 * Those links expire. A client who leaves the tab open, or who is part-way
 * through a large download, ends up fetching dead links — and an expired
 * Supabase link doesn't fail loudly, it returns a small error document. Saved
 * with a .jpg name that becomes a file the operating system refuses to open
 * ("file not supported"), and inside a zip it silently goes missing.
 *
 * So downloads re-sign immediately before they run, rather than trusting
 * whatever was minted when the page loaded.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Same access rule as the page itself.
  const { data: access } = await service
    .from("gallery_access")
    .select("id")
    .eq("gallery_id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Respect the gallery's time limit.
  const { data: gallery } = await service
    .from("galleries")
    .select("expires_at")
    .eq("id", params.id)
    .single();
  if (gallery?.expires_at && new Date(gallery.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "This gallery has expired." }, { status: 403 });
  }

  const { data: photos } = await service
    .from("photos")
    .select("id, storage_path")
    .eq("gallery_id", params.id);
  const { data: videos } = await service
    .from("videos")
    .select("id, storage_path, storage_host")
    .eq("gallery_id", params.id);

  // Six hours: comfortably longer than any realistic download session, without
  // minting links that outlive the gallery itself.
  const TTL = 60 * 60 * 6;

  const photoPaths = (photos ?? []).map((p) => p.storage_path);
  const { data: ps } = photoPaths.length
    ? await service.storage.from("listing-photos").createSignedUrls(photoPaths, TTL)
    : { data: [] };
  const pmap = new Map((ps ?? []).map((d) => [d.path, d.signedUrl]));

  const vmap = await signVideoUrls(service, videos ?? [], { expiresIn: TTL });

  return NextResponse.json({
    photos: Object.fromEntries((photos ?? []).map((p) => [p.id, pmap.get(p.storage_path) ?? null])),
    videos: Object.fromEntries((videos ?? []).map((v) => [v.id, vmap.get(v.id) ?? null])),
  });
}
