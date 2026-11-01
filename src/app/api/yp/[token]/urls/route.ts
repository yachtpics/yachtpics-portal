import { NextRequest, NextResponse } from "next/server";
import { getYpSharedSlideshow } from "@/lib/publicSlideshow";
import { handleSlideshowUrls } from "@/lib/slideshowUrlsHandler";
import { cleanYpToken } from "@/lib/ypShare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/yp/[token]/urls — the link-refresh route for the YachtPics share
 * link (/yp/[token], Nov 1). Same contract as /api/s/[slug]/urls (shared
 * handler); the rule is the share link's: published + yp_share_enabled, no
 * plan check (getYpSharedSlideshow).
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const token = cleanYpToken(params.token);
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return handleSlideshowUrls(req, `yp-urls:${token}`, async () => (await getYpSharedSlideshow(token))?.listing ?? null);
}
