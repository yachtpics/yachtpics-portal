import { RUPLOAD_BASE } from "./config";
import { GraphError, graphDelete, graphGet, graphPost, graphPostForm, metaFetch } from "./graph";

/**
 * Meta publishing primitives — Facebook Page Reels and Instagram Reels.
 *
 * Facebook: POST /{page}/video_reels upload_phase=start → POST rupload with
 * the hosted file_url header → POST /{page}/video_reels upload_phase=finish.
 * Instagram: POST /{ig}/media media_type=REELS → poll status_code until
 * FINISHED → POST /{ig}/media_publish.
 */

export type FbReelResult = { videoId: string; permalink: string };

/**
 * Publish (or natively schedule) a Facebook Page reel from a hosted MP4.
 * `scheduleAt` (unix seconds) must be 10 min – 29 days out; Facebook then
 * publishes it itself at that time.
 */
export async function publishFacebookReel(opts: {
  pageId: string;
  pageToken: string;
  fileUrl: string;
  description: string;
  scheduleAt?: number | null;
}): Promise<FbReelResult> {
  const { pageId, pageToken, fileUrl, description, scheduleAt } = opts;

  const start = await graphPost<{ video_id: string; upload_url?: string }>(
    `${pageId}/video_reels`, { upload_phase: "start" }, pageToken
  );
  const videoId = start.video_id;
  if (!videoId) throw new GraphError("Facebook didn't return a video id.", 500);

  // Facebook fetches the file itself from file_url (our short-lived signed R2 link).
  await metaFetch<{ success?: boolean }>(`${RUPLOAD_BASE}/${videoId}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${pageToken}`, file_url: fileUrl },
  });

  await graphPost<{ success?: boolean }>(
    `${pageId}/video_reels`,
    scheduleAt
      ? { upload_phase: "finish", video_id: videoId, video_state: "SCHEDULED", scheduled_publish_time: scheduleAt, description }
      : { upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description },
    pageToken
  );

  return { videoId, permalink: await facebookPermalink(videoId, pageToken) };
}

/**
 * Set a Facebook video's (reel's) cover image: POST /{video_id}/thumbnails
 * with the JPEG as `source` and is_preferred=true. There's no cover field on
 * the video_reels finish step, so this runs after it — it works for both a
 * published and a natively scheduled reel. ≤ 10 MB, same shape as the video.
 */
export async function setFacebookVideoThumbnail(opts: {
  videoId: string;
  pageToken: string;
  image: { bytes: Uint8Array; contentType: "image/jpeg"; filename: string };
}): Promise<void> {
  const { videoId, pageToken, image } = opts;
  const form = new FormData();
  // Copied into a fresh ArrayBuffer: a Buffer/Uint8Array view can sit on a
  // larger shared pool, and Blob would otherwise take the whole pool.
  const bytes = new Uint8Array(image.bytes.byteLength);
  bytes.set(image.bytes);
  form.set("source", new Blob([bytes.buffer], { type: image.contentType }), image.filename);
  form.set("is_preferred", "true");
  const r = await graphPostForm<{ success?: boolean }>(`${videoId}/thumbnails`, form, pageToken);
  if (r && r.success === false) throw new GraphError("Facebook didn't accept the cover image.", 400);
}

/** The reel's public link; falls back to the standard /reel/{id} URL. */
export async function facebookPermalink(videoId: string, pageToken: string): Promise<string> {
  try {
    const r = await graphGet<{ permalink_url?: string }>(videoId, { fields: "permalink_url" }, pageToken);
    if (r.permalink_url) return r.permalink_url.startsWith("http") ? r.permalink_url : `https://www.facebook.com${r.permalink_url}`;
  } catch { /* fall through */ }
  return `https://www.facebook.com/reel/${videoId}`;
}

export type FbVideoStatus = { videoStatus: string | null; publishStatus: string | null; error: string | null };

export async function facebookVideoStatus(videoId: string, pageToken: string): Promise<FbVideoStatus> {
  const r = await graphGet<{ status?: { video_status?: string; processing_phase?: { error?: { message?: string } }; publishing_phase?: { publish_status?: string } } }>(
    videoId, { fields: "status" }, pageToken
  );
  return {
    videoStatus: r.status?.video_status ?? null,
    publishStatus: r.status?.publishing_phase?.publish_status ?? null,
    error: r.status?.processing_phase?.error?.message ?? null,
  };
}

/** Delete a (scheduled) Facebook video — used to cancel a natively scheduled reel. */
export async function deleteFacebookVideo(videoId: string, pageToken: string): Promise<void> {
  await graphDelete(videoId, {}, pageToken);
}

/** Step 1 for Instagram: a REELS container. Instagram then downloads and processes the video. */
export async function createInstagramReelContainer(opts: {
  igUserId: string;
  pageToken: string;
  videoUrl: string;
  caption: string;
  /** A public HTTPS link to a JPEG for the reel's cover (our signed R2 link); omitted = Instagram picks. */
  coverUrl?: string | null;
}): Promise<string> {
  const r = await graphPost<{ id: string }>(
    `${opts.igUserId}/media`,
    { media_type: "REELS", video_url: opts.videoUrl, caption: opts.caption, share_to_feed: true, cover_url: opts.coverUrl ?? undefined },
    opts.pageToken
  );
  if (!r.id) throw new GraphError("Instagram didn't return a container id.", 500);
  return r.id;
}

export type IgContainerStatus = "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED" | string;

export async function instagramContainerStatus(containerId: string, pageToken: string): Promise<{ code: IgContainerStatus; detail: string | null }> {
  const r = await graphGet<{ status_code?: string; status?: string }>(containerId, { fields: "status_code,status" }, pageToken);
  return { code: r.status_code ?? "IN_PROGRESS", detail: r.status ?? null };
}

/**
 * Poll a container until FINISHED (true), a terminal error (throws), or the
 * deadline passes (false — leave it for a later check).
 */
export async function waitForInstagramContainer(containerId: string, pageToken: string, deadlineMs: number, intervalMs = 4000): Promise<boolean> {
  for (;;) {
    const s = await instagramContainerStatus(containerId, pageToken);
    if (s.code === "FINISHED" || s.code === "PUBLISHED") return true;
    if (s.code === "ERROR" || s.code === "EXPIRED") {
      throw new GraphError(`Instagram couldn't process the video (${s.code}${s.detail ? `: ${s.detail}` : ""}).`, 400);
    }
    if (Date.now() + intervalMs > deadlineMs) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Step 3: publish the finished container. Returns the media id and permalink. */
export async function publishInstagramContainer(igUserId: string, containerId: string, pageToken: string): Promise<{ mediaId: string; permalink: string | null }> {
  const r = await graphPost<{ id: string }>(`${igUserId}/media_publish`, { creation_id: containerId }, pageToken);
  let permalink: string | null = null;
  try {
    const m = await graphGet<{ permalink?: string }>(r.id, { fields: "permalink" }, pageToken);
    permalink = m.permalink ?? null;
  } catch { /* the post is up; the link is a nicety */ }
  return { mediaId: r.id, permalink };
}
