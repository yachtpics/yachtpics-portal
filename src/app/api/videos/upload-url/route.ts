import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { r2SignedPutUrl, r2SignedGetUrl, r2VideoConfigured } from "@/lib/r2";
import { resolveVideoUploadTarget, sanitizeVideoContentType } from "@/lib/videoUploadTarget";

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
  const contentType = sanitizeVideoContentType(body?.contentType);

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Who may upload where — the same function the multipart route uses, so the
  // two upload paths can never disagree about access or file layout.
  const target = await resolveVideoUploadTarget(svc, user.id, body);
  if (target instanceof NextResponse) return target;
  const path = target.path;

  const [url, playbackUrl] = await Promise.all([
    r2SignedPutUrl(path, contentType),
    r2SignedGetUrl(path, { expiresIn: 60 * 60 * 6 }),
  ]);

  // contentType is echoed back because the PUT's header must match the one
  // the signature covers EXACTLY. The browser's idea of the file's type can
  // differ from what was signed (some machines report .mp4 files as
  // application/octet-stream), and a mismatch fails as a baffling 403.
  return NextResponse.json({ url, path, playbackUrl, contentType });
}
