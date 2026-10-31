import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { r2SignedGetUrl, r2VideoConfigured } from "@/lib/r2";
import { REVIEW_SHARE_PREFIX } from "@/lib/videoUploadTarget";

export const runtime = "nodejs";

const LINK_HOURS = 24;

/**
 * POST /api/admin/reels/review/link  { path, filename? }   (admin)
 *   → { url, expiresAt }
 *
 * "Send to my phone" for an In Review reel — the listing reel's reel-link,
 * without a listing: the browser has put the MP4 under reel-shares/review/
 * (swept with the other hand-offs after 48 h); this signs a 24-hour download
 * link for it, which the page shows as a QR code. Only paths under that
 * prefix are signed.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  if (!r2VideoConfigured()) return NextResponse.json({ error: "Video storage isn't configured." }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const path = typeof body?.path === "string" ? body.path : "";
  if (!path.startsWith(REVIEW_SHARE_PREFIX) || path.includes("..")) {
    return NextResponse.json({ error: "That file isn't an In Review hand-off." }, { status: 403 });
  }
  const filename = typeof body?.filename === "string" && body.filename.trim()
    ? body.filename.trim().replace(/[\/\\]/g, "_")
    : "in-review.mp4";
  let url: string;
  try {
    url = await r2SignedGetUrl(path, { expiresIn: LINK_HOURS * 3600, downloadAs: filename });
  } catch {
    return NextResponse.json({ error: "Couldn't create the link." }, { status: 502 });
  }
  return NextResponse.json({ url, expiresAt: new Date(Date.now() + LINK_HOURS * 3600 * 1000).toISOString() });
}
