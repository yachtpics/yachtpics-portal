import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { r2SignedGetUrl, r2VideoConfigured, r2VideoGetBytes } from "@/lib/r2";
import { SOCIAL_PUBLISHING_FOR_BROKERS, metaAppIdConfigured, type SocialPlatform, type SocialPostStatus } from "./config";
import { decryptToken } from "./crypto";
import { graphErrorMessage } from "./graph";
import {
  createInstagramReelContainer, facebookPermalink, facebookVideoStatus, publishFacebookReel,
  publishInstagramContainer, setFacebookVideoThumbnail, waitForInstagramContainer,
} from "./publish";

/**
 * Server-only glue for social publishing: who may use it, reading a
 * connection's token, the signed video link Meta fetches, and moving a
 * social_posts row through scheduled → posting → posted / failed.
 * Used by /api/social/* and /api/cron/social.
 */

export function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export type SocialViewer = { userId: string; isAdmin: boolean; allowed: boolean; svc: SupabaseClient };

/** The signed-in viewer and whether Social accounts is open to them. null = not signed in. */
export async function socialViewer(): Promise<SocialViewer | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const svc = serviceClient();
  const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";
  const isBroker = me?.role === "broker" || !me?.role;
  const allowed = metaAppIdConfigured() && (isAdmin || (SOCIAL_PUBLISHING_FOR_BROKERS && isBroker));
  return { userId: user.id, isAdmin, allowed, svc };
}

/** Columns safe to send to a browser — never page_token_enc. */
export const CONNECTION_PUBLIC_COLUMNS = "id, broker_id, fb_user_id, page_id, page_name, ig_user_id, ig_username, token_expires_at, connected_at, updated_at";

export type SocialConnectionRow = {
  id: string; broker_id: string; fb_user_id: string; page_id: string; page_name: string | null;
  page_token_enc: string; ig_user_id: string | null; ig_username: string | null;
};

export type SocialPostRow = {
  id: string; broker_id: string; source_kind: string; source_id: string; platform: SocialPlatform;
  page_id: string; connection_id: string | null; caption: string | null; status: SocialPostStatus;
  scheduled_for: string | null; external_id: string | null; permalink: string | null; error: string | null;
  created_by: string | null; created_at: string; posted_at: string | null; updated_at: string | null;
};

export const POST_COLUMNS = "id, broker_id, source_kind, source_id, platform, page_id, connection_id, caption, status, scheduled_for, external_id, permalink, error, created_by, created_at, posted_at, updated_at";

/** A finished Reel Service reel Meta can be sent. */
export type ReelSource = { id: string; broker_id: string; status: string; video_path: string; storage_host: string | null; caption: string | null };

export async function loadReelSource(svc: SupabaseClient, jobId: string): Promise<ReelSource | { error: string }> {
  const { data: job } = await svc.from("reel_service_jobs")
    .select("id, broker_id, status, video_path, storage_host, caption").eq("id", jobId).maybeSingle();
  if (!job) return { error: "Reel not found." };
  if (job.status !== "ready" && job.status !== "delivered") return { error: "That reel isn't finished yet." };
  if (!job.video_path) return { error: "That reel has no video file." };
  if (job.storage_host && job.storage_host !== "r2") return { error: `Reels stored on "${job.storage_host}" can't be posted yet.` };
  return job as ReelSource;
}

/** A signed link to the reel, good for ~2 hours — long enough for Meta to fetch and process it. */
export async function reelVideoUrl(job: ReelSource): Promise<string> {
  if (!r2VideoConfigured()) throw new Error("Video storage isn't configured.");
  return r2SignedGetUrl(job.video_path, { expiresIn: 2 * 60 * 60 });
}

/**
 * What a post can be made from:
 *  - 'reel_service_job' — source_id = reel_service_jobs.id; the file is the job's.
 *  - 'listing_reel'     — source_id = listings.id; a reel rendered in the
 *    listing's Reel Maker and uploaded to the private bucket under
 *    social-uploads/{listing_id}/ — social_posts.video_path holds the key
 *    (migration 20261018b_social_listing_reels.sql). Admin only for now.
 */
export const SOCIAL_SOURCE_KINDS = ["reel_service_job", "listing_reel"] as const;
export type SocialSourceKind = (typeof SOCIAL_SOURCE_KINDS)[number];

/**
 * The link Meta fetches for a post, signed now (~2 hours). A listing reel's
 * key is read from video_path on demand rather than via POST_COLUMNS, so the
 * Reel Service path keeps working even before migration 20261018b is applied.
 */
export async function postVideoUrl(svc: SupabaseClient, post: SocialPostRow): Promise<string> {
  if (post.source_kind === "listing_reel") {
    const { data, error } = await svc.from("social_posts").select("video_path").eq("id", post.id).maybeSingle();
    if (error) throw new Error(`Couldn't read the reel's file (${error.message}). Is migration 20261018b_social_listing_reels.sql applied?`);
    const path = (data as { video_path?: string | null } | null)?.video_path;
    if (!path) throw new Error("This post has no video file.");
    if (!r2VideoConfigured()) throw new Error("Video storage isn't configured.");
    return r2SignedGetUrl(path, { expiresIn: 2 * 60 * 60 });
  }
  const job = await loadReelSource(svc, post.source_id);
  if ("error" in job) throw new Error(job.error);
  return reelVideoUrl(job);
}

/**
 * A listing reel's chosen cover (social_posts.cover_path, migration
 * 20261018g), or null. Read on its own — like video_path, never via
 * POST_COLUMNS — and a read error counts as "no cover": the cover is a
 * nicety, so a database without the column still posts, just with Meta's
 * own pick.
 */
async function postCoverPath(svc: SupabaseClient, post: SocialPostRow): Promise<string | null> {
  if (post.source_kind !== "listing_reel") return null;
  const { data, error } = await svc.from("social_posts").select("cover_path").eq("id", post.id).maybeSingle();
  if (error) return null;
  return (data as { cover_path?: string | null } | null)?.cover_path ?? null;
}

/** Record how the cover went ('set', or why not). Best effort — never fails a post. */
async function setCoverNote(svc: SupabaseClient, id: string, note: string): Promise<void> {
  await svc.from("social_posts").update({ cover_note: note.slice(0, 300) }).eq("id", id).then(() => undefined, () => undefined);
}

export async function loadConnection(svc: SupabaseClient, id: string): Promise<SocialConnectionRow | null> {
  const { data } = await svc.from("social_connections")
    .select("id, broker_id, fb_user_id, page_id, page_name, page_token_enc, ig_user_id, ig_username").eq("id", id).maybeSingle();
  return (data as SocialConnectionRow | null) ?? null;
}

async function update(svc: SupabaseClient, id: string, patch: Partial<SocialPostRow>): Promise<SocialPostRow | null> {
  const { data } = await svc.from("social_posts").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id).select(POST_COLUMNS).maybeSingle();
  return (data as SocialPostRow | null) ?? null;
}

async function fail(svc: SupabaseClient, id: string, e: unknown): Promise<SocialPostRow | null> {
  return update(svc, id, { status: "failed", error: graphErrorMessage(e).slice(0, 1000) });
}

/** The connection behind a post (by connection_id, else broker + page). */
async function connectionFor(svc: SupabaseClient, post: SocialPostRow): Promise<SocialConnectionRow | null> {
  if (post.connection_id) {
    const c = await loadConnection(svc, post.connection_id);
    if (c) return c;
  }
  const { data } = await svc.from("social_connections")
    .select("id, broker_id, fb_user_id, page_id, page_name, page_token_enc, ig_user_id, ig_username")
    .eq("page_id", post.page_id).eq("broker_id", post.broker_id).maybeSingle();
  return (data as SocialConnectionRow | null) ?? null;
}

/**
 * Send one post to Meta. The row must already be 'posting' (claimed).
 *  - Facebook: uploads and publishes, or — with `fbScheduleAt` (unix s) —
 *    hands the reel to Facebook to publish at that time (row → 'scheduled'
 *    with external_id set; the cron marks it posted afterwards).
 *  - Instagram: creates the container and waits until `deadlineMs`; if it's
 *    still processing, the row stays 'posting' with the container id in
 *    external_id and advancePost() finishes it later.
 * A listing reel with a chosen cover (cover_path) sends it too — Facebook as
 * an upload once the reel is in, Instagram as cover_url on the container. A
 * cover Meta refuses is noted in cover_note; the post itself carries on.
 */
export async function startPost(svc: SupabaseClient, post: SocialPostRow, opts: { deadlineMs: number; fbScheduleAt?: number | null }): Promise<SocialPostRow | null> {
  try {
    const conn = await connectionFor(svc, post);
    if (!conn) throw new Error("The Facebook Page connection was removed.");
    const token = decryptToken(conn.page_token_enc);
    const videoUrl = await postVideoUrl(svc, post);
    const caption = post.caption ?? "";
    const coverPath = await postCoverPath(svc, post);

    if (post.platform === "facebook") {
      const r = await publishFacebookReel({ pageId: conn.page_id, pageToken: token, fileUrl: videoUrl, description: caption, scheduleAt: opts.fbScheduleAt ?? null });
      // The reel is in (published or held for its time); now the cover. Any
      // failure here is noted and the post still counts as posted/scheduled.
      if (coverPath) {
        try {
          const bytes = await r2VideoGetBytes(coverPath);
          await setFacebookVideoThumbnail({ videoId: r.videoId, pageToken: token, image: { bytes, contentType: "image/jpeg", filename: "cover.jpg" } });
          await setCoverNote(svc, post.id, "set");
        } catch (e) {
          await setCoverNote(svc, post.id, graphErrorMessage(e));
        }
      }
      if (opts.fbScheduleAt) {
        return update(svc, post.id, { status: "scheduled", external_id: r.videoId, permalink: r.permalink, error: null });
      }
      return update(svc, post.id, { status: "posted", external_id: r.videoId, permalink: r.permalink, error: null, posted_at: new Date().toISOString() });
    }

    if (!conn.ig_user_id) throw new Error("This Page has no linked Instagram professional account.");
    let containerId: string;
    if (coverPath) {
      // Signed like the video (~2 h): Instagram fetches the cover while it
      // processes. If the container is refused WITH a cover, try once more
      // without it — a bad cover must not cost the post.
      try {
        const coverUrl = await r2SignedGetUrl(coverPath, { expiresIn: 2 * 60 * 60 });
        containerId = await createInstagramReelContainer({ igUserId: conn.ig_user_id, pageToken: token, videoUrl, caption, coverUrl });
        await setCoverNote(svc, post.id, "set");
      } catch (e) {
        await setCoverNote(svc, post.id, graphErrorMessage(e));
        containerId = await createInstagramReelContainer({ igUserId: conn.ig_user_id, pageToken: token, videoUrl, caption });
      }
    } else {
      containerId = await createInstagramReelContainer({ igUserId: conn.ig_user_id, pageToken: token, videoUrl, caption });
    }
    await update(svc, post.id, { external_id: containerId });
    const ready = await waitForInstagramContainer(containerId, token, opts.deadlineMs);
    if (!ready) return update(svc, post.id, { status: "posting", external_id: containerId, error: null });
    const pub = await publishInstagramContainer(conn.ig_user_id, containerId, token);
    return update(svc, post.id, { status: "posted", external_id: pub.mediaId, permalink: pub.permalink, error: null, posted_at: new Date().toISOString() });
  } catch (e) {
    return fail(svc, post.id, e);
  }
}

/** Claim a scheduled row (scheduled → posting). Returns null if someone else got it first. */
export async function claimScheduled(svc: SupabaseClient, id: string): Promise<SocialPostRow | null> {
  const { data } = await svc.from("social_posts").update({ status: "posting", updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", "scheduled").select(POST_COLUMNS).maybeSingle();
  return (data as SocialPostRow | null) ?? null;
}

/** A 'posting' row with no Meta id this old was cut off mid-request. */
const STALE_POSTING_MS = 10 * 60 * 1000;

/**
 * Move a post forward if it can be:
 *  - Instagram 'posting' with a container → publish when FINISHED.
 *  - Facebook 'scheduled' that Facebook holds (external_id) and is now due → posted.
 *  - 'scheduled' without a Meta id and due → publish now.
 *  - 'posting' with no Meta id for 10+ minutes → failed (interrupted).
 */
export async function advancePost(svc: SupabaseClient, post: SocialPostRow, deadlineMs: number): Promise<SocialPostRow | null> {
  const now = Date.now();
  const due = !post.scheduled_for || new Date(post.scheduled_for).getTime() <= now;
  try {
    if (post.status === "posting" && post.platform === "instagram" && post.external_id) {
      const conn = await connectionFor(svc, post);
      if (!conn || !conn.ig_user_id) throw new Error("The Facebook Page connection was removed.");
      const token = decryptToken(conn.page_token_enc);
      const ready = await waitForInstagramContainer(post.external_id, token, deadlineMs);
      if (!ready) return post;
      const pub = await publishInstagramContainer(conn.ig_user_id, post.external_id, token);
      return update(svc, post.id, { status: "posted", external_id: pub.mediaId, permalink: pub.permalink, error: null, posted_at: new Date().toISOString() });
    }
    if (post.status === "posting" && !post.external_id) {
      const since = new Date(post.updated_at ?? post.created_at).getTime();
      if (now - since > STALE_POSTING_MS) return update(svc, post.id, { status: "failed", error: "Posting was interrupted before Meta confirmed it. Try again." });
      return post;
    }
    if (post.status === "scheduled" && post.platform === "facebook" && post.external_id) {
      if (!due) return post;
      const conn = await connectionFor(svc, post);
      if (!conn) return update(svc, post.id, { status: "posted", posted_at: post.scheduled_for ?? new Date().toISOString() });
      const token = decryptToken(conn.page_token_enc);
      const s = await facebookVideoStatus(post.external_id, token).catch(() => null);
      if (s?.error || s?.videoStatus === "error" || s?.publishStatus === "error") {
        return update(svc, post.id, { status: "failed", error: s?.error ?? "Facebook couldn't publish the scheduled reel." });
      }
      if (s && s.publishStatus && s.publishStatus !== "published") return post;
      const permalink = await facebookPermalink(post.external_id, token);
      return update(svc, post.id, { status: "posted", permalink, posted_at: post.scheduled_for ?? new Date().toISOString() });
    }
    if (post.status === "scheduled" && !post.external_id && due) {
      const claimed = await claimScheduled(svc, post.id);
      if (!claimed) return post;
      return startPost(svc, claimed, { deadlineMs });
    }
    return post;
  } catch (e) {
    return fail(svc, post.id, e);
  }
}
