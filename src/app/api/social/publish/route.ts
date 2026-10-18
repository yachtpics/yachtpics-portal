import { NextRequest, NextResponse } from "next/server";
import { MAX_CAPTION, SOCIAL_PLATFORMS, SOCIAL_PUBLISHING_FOR_BROKERS, metaConfigured, type SocialPlatform } from "@/lib/meta/config";
import { POST_COLUMNS, loadConnection, loadReelSource, socialViewer, startPost, type SocialPostRow, type SocialSourceKind } from "@/lib/meta/server";
import { r2VideoConfigured, r2VideoSize } from "@/lib/r2";
import { SOCIAL_UPLOAD_PREFIX } from "@/lib/videoUploadTarget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Facebook upload + Instagram processing, inline. 60 s is the Hobby ceiling;
// an Instagram reel still processing at the deadline stays 'posting' and is
// finished by /api/social/posts (the open dialog polls it) or the daily cron.
export const maxDuration = 60;

/** Leave headroom under maxDuration for the final DB writes. */
const INLINE_BUDGET_MS = 45_000;
/**
 * Scheduling window. Facebook's own scheduler needs more than 10 minutes and
 * at most 29 days; 15 minutes leaves margin for the upload itself.
 */
const MIN_SCHEDULE_MS = 15 * 60 * 1000;
const MAX_SCHEDULE_MS = 29 * 24 * 60 * 60 * 1000;

/** Reels Meta accepts through the API: 3–90 seconds, vertical 9:16. */
const MIN_REEL_SEC = 3;
const MAX_REEL_SEC = 90;

/** The Reel Maker's own words for a reel Meta wouldn't take; null = fine. */
function reelShapeProblem(durationSec: number, width: number, height: number): string | null {
  if (!(width > 0 && height > 0) || Math.abs(width / height - 9 / 16) > 0.01) {
    return "Facebook and Instagram Reels must be vertical (9:16) — make a Reel, not a Film.";
  }
  if (!(durationSec >= MIN_REEL_SEC)) return `Reels must be at least ${MIN_REEL_SEC} seconds long.`;
  if (durationSec > MAX_REEL_SEC) return `Facebook Reels must be ${MAX_REEL_SEC} seconds or less — pick a shorter length.`;
  return null;
}

/**
 * POST /api/social/publish
 *   { jobId, connectionId, platforms: ["facebook","instagram"], caption, scheduledFor? }
 *   { sourceKind: "listing_reel", listingId, videoPath, durationSec, width, height,
 *     connectionId, platforms, caption, scheduledFor? }
 *
 * Posts a finished Reel Service reel — or a listing reel the admin just made
 * in the listing's Reel Maker and uploaded to social-uploads/{listing}/ — to a
 * connected Facebook Page and/or its Instagram account, one social_posts row
 * per platform. Listing reels are admin only (whatever
 * SOCIAL_PUBLISHING_FOR_BROKERS says) and keep their file key in video_path.
 *  - Now: runs inline (Facebook and Instagram in parallel).
 *  - Scheduled (15 min – 29 days out): Facebook holds the reel and publishes
 *    it itself at that exact time; Instagram has no scheduling API, so its
 *    row waits for the daily cron (13:00 UTC) on or after the chosen time.
 * Admin only while SOCIAL_PUBLISHING_FOR_BROKERS is false.
 */
export async function POST(req: NextRequest) {
  const viewer = await socialViewer();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!viewer.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!metaConfigured()) return NextResponse.json({ error: "Facebook isn't configured on the portal yet." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const sourceKind: SocialSourceKind = body?.sourceKind === "listing_reel" ? "listing_reel" : "reel_service_job";
  const jobId = String(body?.jobId ?? "");
  const listingId = String(body?.listingId ?? "");
  const videoPath = String(body?.videoPath ?? "");
  const connectionId = String(body?.connectionId ?? "");
  const caption = String(body?.caption ?? "").trim();
  const platforms: SocialPlatform[] = (Array.isArray(body?.platforms) ? body.platforms : [])
    .map(String).filter((p: string, i: number, a: string[]) => (SOCIAL_PLATFORMS as readonly string[]).indexOf(p) >= 0 && a.indexOf(p) === i);
  if (sourceKind === "reel_service_job" && !jobId) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  if (sourceKind === "listing_reel" && (!listingId || !videoPath)) return NextResponse.json({ error: "Missing the listing or its uploaded reel." }, { status: 400 });
  if (platforms.length === 0) return NextResponse.json({ error: "Pick Facebook, Instagram, or both." }, { status: 400 });
  if (caption.length > MAX_CAPTION) return NextResponse.json({ error: `Caption is too long (Instagram allows ${MAX_CAPTION} characters).` }, { status: 400 });

  let scheduledFor: Date | null = null;
  if (body?.scheduledFor) {
    const d = new Date(String(body.scheduledFor));
    if (isNaN(d.getTime())) return NextResponse.json({ error: "That date and time isn't valid." }, { status: 400 });
    const ahead = d.getTime() - Date.now();
    if (ahead > MAX_SCHEDULE_MS) return NextResponse.json({ error: "Schedule up to 29 days ahead." }, { status: 400 });
    if (ahead < MIN_SCHEDULE_MS) return NextResponse.json({ error: "Pick a time at least 15 minutes from now, or choose Post now." }, { status: 400 });
    scheduledFor = d;
  }

  // What's being posted: whose it is (social_posts.broker_id), its id, and —
  // for a listing reel — the uploaded file's key.
  let source: { brokerId: string; sourceId: string; videoPath: string | null };
  if (sourceKind === "listing_reel") {
    // Admin only for now, even once brokers can post their Reel Service reels.
    if (!viewer.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const problem = reelShapeProblem(Number(body?.durationSec), Number(body?.width), Number(body?.height));
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const { data: listing } = await viewer.svc.from("listings").select("id, broker_id").eq("id", listingId).maybeSingle();
    if (!listing?.broker_id) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    // Only a file the upload route put under this listing's social-uploads/ folder.
    if (!videoPath.startsWith(`${SOCIAL_UPLOAD_PREFIX}${listing.id}/`) || videoPath.indexOf("..") >= 0 || !/\.mp4$/.test(videoPath)) {
      return NextResponse.json({ error: "That file doesn't belong to this listing." }, { status: 400 });
    }
    if (!r2VideoConfigured()) return NextResponse.json({ error: "Video storage isn't configured." }, { status: 500 });
    const size = await r2VideoSize(videoPath);
    if (!size) return NextResponse.json({ error: "The reel didn't finish uploading. Try again." }, { status: 400 });
    source = { brokerId: listing.broker_id, sourceId: listing.id, videoPath };
  } else {
    const job = await loadReelSource(viewer.svc, jobId);
    if ("error" in job) return NextResponse.json({ error: job.error }, { status: 400 });
    if (!viewer.isAdmin) {
      // Broker path (when SOCIAL_PUBLISHING_FOR_BROKERS opens it): own delivered reel.
      if (!SOCIAL_PUBLISHING_FOR_BROKERS || job.broker_id !== viewer.userId || job.status !== "delivered") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    source = { brokerId: job.broker_id, sourceId: job.id, videoPath: null };
  }

  const conn = connectionId ? await loadConnection(viewer.svc, connectionId) : null;
  if (!conn) return NextResponse.json({ error: "Pick a connected Facebook Page." }, { status: 400 });
  // Brokers post to their own Page only.
  if (!viewer.isAdmin && conn.broker_id !== viewer.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (platforms.indexOf("instagram") >= 0 && !conn.ig_user_id) {
    return NextResponse.json({ error: "This Page has no linked Instagram professional account." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const rows = platforms.map((platform) => ({
    broker_id: source.brokerId,
    source_kind: sourceKind,
    source_id: source.sourceId,
    // Only listing reels carry a file key (and only they need migration
    // 20261018b) — Reel Service rows are inserted exactly as before.
    ...(source.videoPath ? { video_path: source.videoPath } : {}),
    platform,
    page_id: conn.page_id,
    connection_id: conn.id,
    caption,
    // Facebook-native schedules are uploaded right now (status flips to
    // 'scheduled' once Facebook accepts), so they start as 'posting'.
    status: scheduledFor && platform === "instagram" ? "scheduled" : "posting",
    scheduled_for: scheduledFor ? scheduledFor.toISOString() : null,
    created_by: viewer.userId,
    created_at: now,
    updated_at: now,
  }));
  const { data: inserted, error } = await viewer.svc.from("social_posts").insert(rows).select(POST_COLUMNS);
  if (error) {
    const hint = sourceKind === "listing_reel" && /video_path/.test(error.message)
      ? " (the database update 20261018b_social_listing_reels.sql hasn't been run yet)" : "";
    return NextResponse.json({ error: `Couldn't record the post: ${error.message}${hint}` }, { status: 500 });
  }

  const deadlineMs = Date.now() + INLINE_BUDGET_MS;
  const posts = (inserted ?? []) as SocialPostRow[];
  const results = await Promise.all(posts.map(async (p) => {
    if (p.status !== "posting") return p;
    const fbScheduleAt = p.platform === "facebook" && scheduledFor ? Math.floor(scheduledFor.getTime() / 1000) : null;
    return (await startPost(viewer.svc, p, { deadlineMs, fbScheduleAt })) ?? p;
  }));

  return NextResponse.json({ ok: true, posts: results });
}
