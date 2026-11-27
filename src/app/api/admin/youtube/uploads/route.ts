import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { enqueueJob, jobsBaseUrl, kickWorker } from "@/lib/jobs/queue";
import { isYouTubePrivacy } from "@/lib/youtube/config";
import { sanitizeDescription, sanitizeTitle } from "@/lib/youtube/metadata";
import {
  PUBLIC_UPLOAD_COLUMNS, isMissingYouTubeSchema, listChannels, listingPrefill, listingUploads, toPublicUpload, youtubeReadiness,
  type UploadRow,
} from "@/lib/youtube/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALREADY = "This video is already on its way to YouTube. Wait for that upload to finish, or stop it first.";

/**
 * GET /api/admin/youtube/uploads?listingId= → everything the listing page's
 * "Upload to YouTube" needs in one call: { configured, ready, reason?,
 * channels, uploads, prefill: { title, description }, listingYoutubeUrl }.
 * Admin only. Before the env vars / migration: configured / ready false and
 * nothing else — never an error.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const listingId = req.nextUrl.searchParams.get("listingId") ?? "";
  if (!UUID.test(listingId)) return NextResponse.json({ error: "Unknown listing." }, { status: 400 });

  const r = await youtubeReadiness(auth.admin);
  if (!r.ready) return NextResponse.json({ configured: r.configured, ready: false, reason: r.reason });

  const [channels, uploads, prefill] = await Promise.all([
    listChannels(auth.admin),
    listingUploads(auth.admin, listingId),
    listingPrefill(auth.admin, listingId),
  ]);
  if (channels.missing || uploads.missing) return NextResponse.json({ configured: true, ready: false, reason: "migration" });
  if (channels.error || uploads.error) return NextResponse.json({ error: channels.error ?? uploads.error }, { status: 500 });
  if (!prefill) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  return NextResponse.json({
    configured: true,
    ready: true,
    channels: channels.channels,
    uploads: uploads.uploads,
    prefill: { title: prefill.title, description: prefill.description },
    listingYoutubeUrl: prefill.youtubeUrl,
  });
}

/**
 * POST /api/admin/youtube/uploads
 *   { listingId, videoId, channelId, title, description, privacy,
 *     setListingLink, replaceListingLink }
 * Admin only. Checks everything, records the upload and queues a
 * `youtube_upload` job (src/lib/jobs/youtubeUpload.ts), then wakes the worker.
 * One active upload per video.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const svc = auth.admin;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const listingId = typeof body.listingId === "string" ? body.listingId : "";
  const videoId = typeof body.videoId === "string" ? body.videoId : "";
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  if (!UUID.test(listingId) || !UUID.test(videoId)) return NextResponse.json({ error: "Unknown video." }, { status: 400 });
  if (!UUID.test(channelId)) return NextResponse.json({ error: "Pick a YouTube channel." }, { status: 400 });
  const title = sanitizeTitle(body.title);
  if (!title) return NextResponse.json({ error: "Give the video a title." }, { status: 400 });
  const description = sanitizeDescription(body.description);
  const privacy = isYouTubePrivacy(body.privacy) ? body.privacy : null;
  if (!privacy) return NextResponse.json({ error: "Pick Public, Unlisted or Private." }, { status: 400 });
  const setListingLink = body.setListingLink === true;
  const replaceListingLink = setListingLink && body.replaceListingLink === true;

  const ready = await youtubeReadiness(svc);
  if (!ready.ready) return NextResponse.json({ error: "YouTube isn't set up yet." }, { status: 409 });

  const [{ data: video }, { data: channel, error: chErr }, { data: active, error: actErr }] = await Promise.all([
    svc.from("videos").select("id, listing_id").eq("id", videoId).maybeSingle(),
    svc.from("youtube_channels").select("id, needs_reconnect").eq("id", channelId).maybeSingle(),
    svc.from("youtube_uploads").select("id").eq("video_id", videoId).in("status", ["queued", "uploading", "processing"]).limit(1),
  ]);
  if (chErr || actErr) {
    const e = chErr ?? actErr;
    if (isMissingYouTubeSchema(e)) return NextResponse.json({ error: "YouTube isn't set up yet." }, { status: 409 });
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
  if (!video || video.listing_id !== listingId) return NextResponse.json({ error: "That video isn't on this listing." }, { status: 404 });
  if (!channel) return NextResponse.json({ error: "That YouTube channel isn't connected any more." }, { status: 404 });
  if (channel.needs_reconnect) {
    return NextResponse.json({ error: "That channel needs connecting again. Go to Admin → YouTube and connect it." }, { status: 409 });
  }
  if ((active ?? []).length) return NextResponse.json({ error: ALREADY }, { status: 409 });

  const { data: row, error: insErr } = await svc
    .from("youtube_uploads")
    .insert({
      listing_id: listingId,
      video_id: videoId,
      channel_id: channelId,
      title,
      description,
      privacy,
      set_listing_link: setListingLink,
      replace_listing_link: replaceListingLink,
      status: "queued",
      started_by: auth.userId,
    })
    .select("*")
    .single();
  if (insErr || !row) {
    // The partial unique index (one active upload per video) caught a double click.
    if (insErr?.code === "23505") return NextResponse.json({ error: ALREADY }, { status: 409 });
    return NextResponse.json({ error: insErr?.message ?? "Couldn't start the upload." }, { status: 500 });
  }
  const upload = row as UploadRow;

  const q = await enqueueJob("youtube_upload", { uploadId: upload.id }, auth.userId, svc);
  if (q.error !== undefined) {
    const now = new Date().toISOString();
    await svc.from("youtube_uploads").update({ status: "failed", error: q.error, finished_at: now, updated_at: now }).eq("id", upload.id);
    return NextResponse.json({ error: q.notReady ? "Background jobs aren't set up, so the upload can't run." : q.error }, { status: q.notReady ? 409 : 500 });
  }
  const { data: withJob } = await svc
    .from("youtube_uploads")
    .update({ job_id: q.job.id, updated_at: new Date().toISOString() })
    .eq("id", upload.id)
    .select(PUBLIC_UPLOAD_COLUMNS)
    .single();
  kickWorker(jobsBaseUrl(req));
  return NextResponse.json({ upload: toPublicUpload((withJob ?? upload) as unknown as UploadRow) });
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
