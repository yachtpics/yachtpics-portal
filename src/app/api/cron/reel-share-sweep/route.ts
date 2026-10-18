import { NextRequest, NextResponse } from "next/server";
import { r2VideoConfigured, r2VideoDelete, r2VideoListPrefix } from "@/lib/r2";
import { REEL_SHARE_PREFIX, SOCIAL_UPLOAD_PREFIX } from "@/lib/videoUploadTarget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A hand-off link lives 24 hours; the file gets a day's grace on top. */
const MAX_AGE_MS = 48 * 3600 * 1000;
/**
 * Listing reels sent to Facebook / Instagram: a post can be scheduled up to
 * 29 days ahead (Instagram then goes at the next daily run), so keep 35 days.
 */
const SOCIAL_MAX_AGE_MS = 35 * 24 * 3600 * 1000;

/**
 * Sweeps expired reel hand-offs out of the private bucket.
 *
 * "Send to my phone" parks a copy of the reel under reel-shares/ so a signed
 * link can point at it. Those copies have no database row and no purpose once
 * the link has expired — but nothing would ever delete them, and a fortnight of
 * enthusiastic brokers is a lot of 30 MB files. Runs daily from the dispatcher.
 * Also sweeps social-uploads/ (listing reels sent to Facebook / Instagram)
 * after 35 days — Meta keeps its own copy once a post is up.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!r2VideoConfigured()) return NextResponse.json({ skipped: "video bucket not configured" });

  const now = Date.now();
  let removed = 0;
  let kept = 0;
  const failed: string[] = [];

  // A listing failure must not look like an empty bucket — that's how files
  // pile up for months under a cron that reports success every morning.
  let objects: { key: string; lastModified: Date | null; cutoff: number }[];
  try {
    const [shares, social] = await Promise.all([
      r2VideoListPrefix(REEL_SHARE_PREFIX),
      r2VideoListPrefix(SOCIAL_UPLOAD_PREFIX),
    ]);
    objects = shares.map((o) => ({ ...o, cutoff: now - MAX_AGE_MS }))
      .concat(social.map((o) => ({ ...o, cutoff: now - SOCIAL_MAX_AGE_MS })));
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Couldn't list the bucket." },
      { status: 502 }
    );
  }
  for (const o of objects) {
    // No timestamp means we can't prove it's old — leave it for next time
    // rather than delete on a guess.
    if (!o.lastModified || o.lastModified.getTime() > o.cutoff) { kept++; continue; }
    try {
      await r2VideoDelete(o.key);
      removed++;
    } catch {
      failed.push(o.key);
    }
  }

  return NextResponse.json({ ok: true, scanned: objects.length, removed, kept, failed: failed.length });
}
