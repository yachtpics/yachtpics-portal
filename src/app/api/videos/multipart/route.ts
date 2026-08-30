import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { r2VideoConfigured, r2SignedPartUrl, r2SignedGetUrl, R2_VIDEO_BUCKET, r2VideoSize } from "@/lib/r2";
import { startCopy, finishCopy, abortCopy } from "@/lib/r2ChunkedCopy";
import {
  resolveVideoUploadTarget,
  assertPathBelongsToTarget,
  sanitizeVideoContentType,
} from "@/lib/videoUploadTarget";
import type { PartRef } from "@/lib/r2ChunkedCopy";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/videos/multipart — large uploads, in pieces that survive a bad
 * connection.
 *
 * A single 2GB PUT straight from a browser has to run perfectly for minutes;
 * one connection reset anywhere along the way and the whole file is lost.
 * That's not hypothetical — it's exactly the failure that was killing real
 * uploads. So above a threshold the browser sends the file as numbered 32MB
 * parts, each to its own signed URL, and RETRIES just the part that failed.
 * A flaky connection costs seconds, not the upload.
 *
 * Actions:
 *   start    { listingId|galleryId, filename, contentType, totalBytes }
 *            → { uploadId, path, playbackUrl, partSize, partUrls[] }
 *   complete { listingId|galleryId, path, uploadId, parts[], totalBytes }
 *            → { done } — only after R2's byte count matches the file's
 *   abort    { listingId|galleryId, path, uploadId }
 *
 * Access control is the same function the single-shot route uses, so the two
 * paths cannot disagree about who may upload where. complete/abort re-check
 * that the path the browser hands back is inside the caller's own folder.
 */

/** 32MB pieces — small enough that a retry is cheap, big enough that a 2GB
 *  file is ~64 requests, not thousands. (S3 minimum is 5MB per part.) Not
 *  exported: route files may only export handlers, and the browser gets this
 *  number from the start response anyway. */
const UPLOAD_PART_SIZE = 32 * 1024 * 1024;

/** R2 caps multipart uploads at 10,000 parts; at 32MB that's ~312GB. A number
 *  beyond it is a corrupt or malicious request, not a real video. */
const MAX_PARTS = 10_000;

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!r2VideoConfigured()) {
    return NextResponse.json({ error: "Video storage isn't configured." }, { status: 500 });
  }

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  // ── start ────────────────────────────────────────────────────────────────
  if (action === "start") {
    const target = await resolveVideoUploadTarget(svc, user.id, body);
    if (target instanceof NextResponse) return target;

    const totalBytes = Number(body?.totalBytes);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      return NextResponse.json({ error: "Missing file size" }, { status: 400 });
    }
    const partCount = Math.ceil(totalBytes / UPLOAD_PART_SIZE);
    if (partCount > MAX_PARTS) {
      return NextResponse.json({ error: "That file is too large to upload." }, { status: 413 });
    }

    const contentType = sanitizeVideoContentType(body?.contentType);
    const uploadId = await startCopy(R2_VIDEO_BUCKET, target.path, contentType);

    // Sign every part URL up front — one round trip instead of one per part.
    // Six-hour expiry: enough for a big file on a slow connection, and the
    // upload id dies with an abort anyway if the whole thing is abandoned.
    const partUrls = await Promise.all(
      Array.from({ length: partCount }, (_, i) => r2SignedPartUrl(target.path, uploadId, i + 1))
    );
    const playbackUrl = await r2SignedGetUrl(target.path, { expiresIn: 60 * 60 * 6 });

    return NextResponse.json({ uploadId, path: target.path, playbackUrl, partSize: UPLOAD_PART_SIZE, partUrls });
  }

  // ── complete ─────────────────────────────────────────────────────────────
  if (action === "complete") {
    const checked = await assertPathBelongsToTarget(svc, user.id, body, body?.path);
    if (checked instanceof NextResponse) return checked;

    const { uploadId, parts, totalBytes } = body;
    if (!uploadId || !Array.isArray(parts) || parts.length === 0) {
      return NextResponse.json({ error: "Missing upload details" }, { status: 400 });
    }
    try {
      await finishCopy(R2_VIDEO_BUCKET, checked.path, uploadId, parts as PartRef[]);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Couldn't finish the upload." },
        { status: 502 }
      );
    }

    // The file only counts as uploaded if Cloudflare holds exactly the bytes
    // the browser sent. A mismatch means a piece went missing or doubled —
    // better to fail loudly now than to store a video that won't play.
    if (Number.isFinite(Number(totalBytes)) && Number(totalBytes) > 0) {
      const size = await r2VideoSize(checked.path);
      if (size !== Number(totalBytes)) {
        return NextResponse.json({
          error: `The upload didn't assemble correctly (${size ?? 0} of ${totalBytes} bytes arrived). Please try again.`,
        }, { status: 502 });
      }
    }

    return NextResponse.json({ done: true });
  }

  // ── abort ────────────────────────────────────────────────────────────────
  // Worth calling on failure: half-finished multipart uploads keep their parts
  // in the bucket, billed but invisible in any file listing.
  if (action === "abort") {
    const checked = await assertPathBelongsToTarget(svc, user.id, body, body?.path);
    if (checked instanceof NextResponse) return checked;
    if (body?.uploadId) {
      await abortCopy(R2_VIDEO_BUCKET, checked.path, body.uploadId).catch(() => {});
    }
    return NextResponse.json({ aborted: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
