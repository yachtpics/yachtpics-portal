import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { r2VideoConfigured, r2VideoCopy, r2VideoSize } from "@/lib/r2";
import { SOCIAL_UPLOAD_PREFIX } from "@/lib/videoUploadTarget";
import { isShowcaseLook, showcaseBoatForListing, showcaseReelKey } from "@/content/showcase";

/**
 * Admin: "Save to showcase" from a listing's Reel Maker.
 *
 * The browser has already put the rendered MP4 in the private video bucket
 * through the Facebook/Instagram upload target (social-uploads/{listing}/…),
 * so this route only copies that object, server side, to the fixed key the
 * public /see page reads: showcase/{boat}/{walkthrough|marquee}.mp4.
 * Overwrites — re-saving is how a showcase reel is replaced. /see re-signs
 * within the hour (its page cache).
 *
 * Body: { listingId, look: "walkthrough" | "marquee", path }.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const listingId = typeof body?.listingId === "string" ? body.listingId : "";
  const look = body?.look;
  const path = typeof body?.path === "string" ? body.path : "";

  if (!isShowcaseLook(look)) return NextResponse.json({ error: "Pick Walkthrough or Marquee." }, { status: 400 });
  const boat = showcaseBoatForListing(listingId);
  if (!boat) return NextResponse.json({ error: "This listing isn't set up for the showcase." }, { status: 400 });
  if (!path.startsWith(`${SOCIAL_UPLOAD_PREFIX}${listingId}/`) || path.includes("..")) {
    return NextResponse.json({ error: "That file doesn't belong to this listing." }, { status: 403 });
  }
  if (!r2VideoConfigured()) return NextResponse.json({ error: "Video storage isn't configured." }, { status: 500 });

  const size = await r2VideoSize(path);
  if (!size) return NextResponse.json({ error: "The uploaded reel wasn't found. Try again." }, { status: 404 });

  const key = showcaseReelKey(boat.key, look);
  try {
    await r2VideoCopy(path, key);
  } catch (e) {
    return NextResponse.json({ error: `Couldn't save the reel: ${e instanceof Error ? e.message : "storage error"}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true, key, bytes: size });
}
