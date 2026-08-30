import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { r2SignedPutUrl, r2SignedGetUrl, r2VideoConfigured } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * POST /api/videos/upload-url
 *   { listingId, filename, contentType }  — listing video (broker/assistant/co-broker/admin)
 *   { galleryId, filename, contentType }  — gallery video (admin only)
 *
 * → { url, path, playbackUrl }
 *
 * New video goes straight from the uploader's browser to the private Cloudflare
 * bucket. Two reasons this is a signed URL rather than an upload through us:
 * the files are far bigger than a serverless function may handle, and it means
 * Supabase storage stops growing — which is the point of the whole migration.
 *
 * `playbackUrl` is a pre-signed GET for the same key, so the page can show the
 * video immediately after upload without a second round trip. Signing a GET
 * needs no object to exist yet; the signature is over the request, not the file.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!r2VideoConfigured()) {
    return NextResponse.json({ error: "Video storage isn't configured." }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const filename = typeof body?.filename === "string" ? body.filename : "video.mp4";
  const contentType =
    typeof body?.contentType === "string" && body.contentType.startsWith("video/")
      ? body.contentType
      : "video/mp4";

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let path: string;

  if (body?.listingId) {
    const access = await assertListingAccess(svc, body.listingId, user.id, { includeCoBroker: true });
    if (access instanceof NextResponse) return access;

    // Filed under the listing OWNER's id — an assistant's or admin's uploads
    // belong with the rest of the broker's media, not in a separate folder.
    const { data: listing } = await svc
      .from("listings")
      .select("broker_id")
      .eq("id", body.listingId)
      .maybeSingle();
    if (!listing?.broker_id) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

    path = `${listing.broker_id}/${body.listingId}/${Date.now()}-${filename}`;
  } else if (body?.galleryId) {
    const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

    const ext = filename.split(".").pop() || "mp4";
    path = `galleries/${body.galleryId}/${crypto.randomUUID()}.${ext}`;
  } else {
    return NextResponse.json({ error: "Missing listingId or galleryId" }, { status: 400 });
  }

  const [url, playbackUrl] = await Promise.all([
    r2SignedPutUrl(path, contentType),
    r2SignedGetUrl(path, { expiresIn: 60 * 60 * 6 }),
  ]);

  return NextResponse.json({ url, path, playbackUrl });
}
