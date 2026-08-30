import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { signVideoUrls, signVideoUrl } from "@/lib/videoUrls";

export const runtime = "nodejs";

/**
 * POST /api/videos/signed-urls
 *   { listingId }                        → { urls: { [videoId]: url } }
 *   { videoId, asDownload?: boolean }    → { url }
 *
 * The browser can't sign links for video on the private Cloudflare bucket —
 * those credentials live only on the server — so the pages that used to sign
 * against Supabase directly from the browser ask here instead. This route
 * answers from whichever store actually holds each file, so the pages don't
 * know or care how far the migration has got.
 *
 * Access is the listing's own rule: broker, their assistants, co-brokers, and
 * admin.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // One video — used for downloads, where the original filename matters.
  if (body?.videoId) {
    const { data: video } = await svc
      .from("videos")
      .select("id, storage_path, storage_host, filename, listing_id")
      .eq("id", body.videoId)
      .maybeSingle();
    if (!video?.listing_id) return NextResponse.json({ error: "Video not found" }, { status: 404 });

    const access = await assertListingAccess(svc, video.listing_id, user.id, { includeCoBroker: true });
    if (access instanceof NextResponse) return access;

    const url = await signVideoUrl(svc, video, { asDownload: body.asDownload === true });
    if (!url) return NextResponse.json({ error: "Couldn't sign that video." }, { status: 502 });
    return NextResponse.json({ url });
  }

  // All of a listing's videos.
  if (body?.listingId) {
    const access = await assertListingAccess(svc, body.listingId, user.id, { includeCoBroker: true });
    if (access instanceof NextResponse) return access;

    const { data: videos } = await svc
      .from("videos")
      .select("id, storage_path, storage_host, filename")
      .eq("listing_id", body.listingId);

    const urls = await signVideoUrls(svc, videos ?? []);
    return NextResponse.json({ urls: Object.fromEntries(urls) });
  }

  return NextResponse.json({ error: "Missing listingId or videoId" }, { status: 400 });
}
