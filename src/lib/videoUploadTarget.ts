import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";

/**
 * Decide whether this user may upload a video to this target, and where the
 * file goes if so.
 *
 * Both upload routes — the single-shot signed PUT and the multipart one for
 * large files — must agree exactly on access rules and path layout, or a file
 * could land somewhere one route would have refused. One function, used by
 * both, is how they're kept identical.
 *
 * Listing videos are filed under the listing OWNER's id: an assistant's or
 * admin's uploads belong with the rest of the broker's media, not in a
 * separate folder. Gallery videos are admin-only.
 */
export type VideoUploadTarget =
  /**
   * `contentType` / `maxBytes` are set only for a non-video target (a reel's
   * cover JPEG): the upload route signs that type instead of the client's,
   * and refuses anything bigger.
   */
  | { path: string; prefix: string; contentType?: string; maxBytes?: number }
  | NextResponse;

export function sanitizeVideoFilename(raw: unknown): string {
  // Path separators are stripped before the name becomes part of a storage
  // key — "../" from a client must never steer where a file lands.
  const name = typeof raw === "string" ? raw : "video.mp4";
  return name.replace(/[\/\\]/g, "_").replace(/\.\.+/g, ".") || "video.mp4";
}

export function sanitizeVideoContentType(raw: unknown): string {
  return typeof raw === "string" && raw.startsWith("video/") ? raw : "video/mp4";
}

/** Where short-lived reel hand-offs live. Swept by the daily cron after 48h. */
export const REEL_SHARE_PREFIX = "reel-shares/";

/**
 * Admin "In Review" reels handed to a phone (Oct 31): reel-shares/review/…,
 * inside the share prefix so the same 48 h sweep clears them.
 */
export const REVIEW_SHARE_PREFIX = `${REEL_SHARE_PREFIX}review/`;

/** Reel Service deliveries: reel-service/{broker_id}/{YYYY-MM}/{job_id}.mp4 */
export const REEL_SERVICE_PREFIX = "reel-service/";

/**
 * Listing reels sent to Facebook / Instagram (admin only, Oct 18):
 * social-uploads/{listing_id}/{uuid}.mp4. Meta fetches the file through a
 * short-lived signed link made at posting time; swept after 35 days (the
 * longest schedule is 29 days ahead).
 */
export const SOCIAL_UPLOAD_PREFIX = "social-uploads/";

/**
 * The chosen cover frame for a listing reel going to Facebook / Instagram:
 * social-uploads/{listing_id}/{uuid}.jpg, next to its MP4 (and swept with it).
 * 10 MB is Facebook's limit for a video thumbnail.
 */
export const SOCIAL_COVER_MAX_BYTES = 10 * 1024 * 1024;

export async function resolveVideoUploadTarget(
  svc: SupabaseClient,
  userId: string,
  body: { listingId?: unknown; galleryId?: unknown; filename?: unknown; share?: unknown; reelServiceJobId?: unknown; socialUpload?: unknown; socialCover?: unknown; reviewShare?: unknown }
): Promise<VideoUploadTarget> {
  const filename = sanitizeVideoFilename(body?.filename);

  // Reel Service (Oct 4): a reel rendered in the admin's browser for an
  // enrolled broker. Admin only; one key per job, overwritten on a re-render.
  if (body?.reelServiceJobId && typeof body.reelServiceJobId === "string") {
    const { data: me } = await svc.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
    const { data: job } = await svc
      .from("reel_service_jobs")
      .select("id, broker_id, period")
      .eq("id", body.reelServiceJobId)
      .maybeSingle();
    if (!job) return NextResponse.json({ error: "Reel job not found" }, { status: 404 });
    const prefix = `${REEL_SERVICE_PREFIX}${job.broker_id}/${job.period}/`;
    return { prefix, path: `${prefix}${job.id}.mp4` };
  }

  // An admin In Review reel going to the admin's own phone (no listing).
  if (body?.reviewShare === true) {
    const { data: me } = await svc.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
    return { prefix: REVIEW_SHARE_PREFIX, path: `${REVIEW_SHARE_PREFIX}${Date.now()}-${filename}` };
  }

  // A listing reel going to Facebook / Instagram. Admin only while posting
  // is (SOCIAL_PUBLISHING_FOR_BROKERS); the server picks the whole key.
  if (body?.socialUpload === true && body?.listingId && typeof body.listingId === "string") {
    const { data: me } = await svc.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
    const { data: listing } = await svc.from("listings").select("id").eq("id", body.listingId).maybeSingle();
    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    const prefix = `${SOCIAL_UPLOAD_PREFIX}${listing.id}/`;
    // The reel's cover frame (Oct 18, g): same folder, a JPEG, and the server
    // — not the browser — decides it's image/jpeg and how big it may be.
    if (body?.socialCover === true) {
      return { prefix, path: `${prefix}${crypto.randomUUID()}.jpg`, contentType: "image/jpeg", maxBytes: SOCIAL_COVER_MAX_BYTES };
    }
    return { prefix, path: `${prefix}${crypto.randomUUID()}.mp4` };
  }

  if (body?.listingId && typeof body.listingId === "string") {
    const access = await assertListingAccess(svc, body.listingId, userId, { includeCoBroker: true });
    if (access instanceof NextResponse) return access;

    // A reel being handed to a phone is not part of the listing's media. It
    // lives under its own prefix — no database row, swept after two days — so
    // it can't be mistaken for a delivered video or linger as an orphan.
    if (body?.share === true) {
      const prefix = `${REEL_SHARE_PREFIX}${body.listingId}/`;
      return { prefix, path: `${prefix}${Date.now()}-${filename}` };
    }

    const { data: listing } = await svc
      .from("listings")
      .select("broker_id")
      .eq("id", body.listingId)
      .maybeSingle();
    if (!listing?.broker_id) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

    const prefix = `${listing.broker_id}/${body.listingId}/`;
    return { prefix, path: `${prefix}${Date.now()}-${filename}` };
  }

  if (body?.galleryId && typeof body.galleryId === "string") {
    const { data: me } = await svc.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

    const ext = filename.split(".").pop() || "mp4";
    const prefix = `galleries/${body.galleryId}/`;
    return { prefix, path: `${prefix}${crypto.randomUUID()}.${ext}` };
  }

  return NextResponse.json({ error: "Missing listingId or galleryId" }, { status: 400 });
}

/**
 * For multipart continue/finish calls: the browser hands the path back, so
 * before acting on it, confirm it sits inside the folder this user was allowed
 * to upload to in the first place. Without this, anyone entitled to upload to
 * one listing could complete or abort uploads against any key in the bucket.
 */
export async function assertPathBelongsToTarget(
  svc: SupabaseClient,
  userId: string,
  body: { listingId?: unknown; galleryId?: unknown; share?: unknown; reelServiceJobId?: unknown; socialUpload?: unknown; socialCover?: unknown; reviewShare?: unknown },
  path: unknown
): Promise<NextResponse | { path: string }> {
  if (typeof path !== "string" || !path) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }
  const target = await resolveVideoUploadTarget(svc, userId, body);
  if (target instanceof NextResponse) return target;
  if (!path.startsWith(target.prefix)) {
    return NextResponse.json({ error: "That file doesn't belong to this upload." }, { status: 403 });
  }
  return { path };
}
