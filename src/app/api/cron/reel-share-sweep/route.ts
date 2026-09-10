import { NextRequest, NextResponse } from "next/server";
import { r2VideoConfigured, r2VideoDelete, r2VideoListPrefix } from "@/lib/r2";
import { REEL_SHARE_PREFIX } from "@/lib/videoUploadTarget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A hand-off link lives 24 hours; the file gets a day's grace on top. */
const MAX_AGE_MS = 48 * 3600 * 1000;

/**
 * Sweeps expired reel hand-offs out of the private bucket.
 *
 * "Send to my phone" parks a copy of the reel under reel-shares/ so a signed
 * link can point at it. Those copies have no database row and no purpose once
 * the link has expired — but nothing would ever delete them, and a fortnight of
 * enthusiastic brokers is a lot of 30 MB files. Runs daily from the dispatcher.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    const querySecret = req.nextUrl.searchParams.get("secret");
    if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  if (!r2VideoConfigured()) return NextResponse.json({ skipped: "video bucket not configured" });

  const cutoff = Date.now() - MAX_AGE_MS;
  let removed = 0;
  let kept = 0;
  const failed: string[] = [];

  const objects = await r2VideoListPrefix(REEL_SHARE_PREFIX).catch(() => []);
  for (const o of objects) {
    // No timestamp means we can't prove it's old — leave it for next time
    // rather than delete on a guess.
    if (!o.lastModified || o.lastModified.getTime() > cutoff) { kept++; continue; }
    try {
      await r2VideoDelete(o.key);
      removed++;
    } catch {
      failed.push(o.key);
    }
  }

  return NextResponse.json({ ok: true, scanned: objects.length, removed, kept, failed: failed.length });
}
