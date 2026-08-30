import type { SupabaseClient } from "@supabase/supabase-js";
import { captureVideoPoster } from "./captureVideoPoster";

/**
 * Upload one video to a listing, with a still frame captured for its cover.
 *
 * Videos can be added in three places — the broker create form, the admin
 * create form, and the listing's Manage page — and they were drifting apart.
 * This is the single path all three use, so a change made once applies
 * everywhere. Gallery uploads share the transport half via
 * `uploadVideoToPrivateBucket`.
 *
 * THE TRANSPORT IS BUILT FOR BAD CONNECTIONS. A single multi-gigabyte PUT
 * from a browser has to run perfectly for minutes, and one connection reset
 * anywhere kills the whole file — which is exactly what was happening on real
 * uploads. So: files above 32MB go up as numbered pieces, each piece retried
 * up to three times on its own, and a drop costs seconds instead of the
 * upload. Small files get the same three attempts on their single PUT.
 *
 * Order of operations still matters:
 *  1. video uploads first, so progress starts moving immediately
 *  2. the database row is written
 *  3. the still is captured and attached afterwards
 *
 * Capturing the still first meant up to ten seconds of a frozen progress bar
 * before a byte moved. Doing it last also means a failed upload can't leave an
 * orphaned still in storage with nothing pointing at it.
 */

export const VIDEO_ACCEPT = ".mp4,.mov,video/mp4,video/quicktime";

/** Files we'll accept — matches what browsers can actually play back. */
export function isSupportedVideo(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === "video/mp4" ||
    file.type === "video/quicktime" ||
    name.endsWith(".mp4") ||
    name.endsWith(".mov")
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1_048_576))} MB`;
}

/** Above this, upload in pieces. Matches the server's part size. */
const MULTIPART_THRESHOLD = 32 * 1024 * 1024;
const ATTEMPTS_PER_PIECE = 3;

type PutResult = { ok: true; etag: string | null } | { ok: false; status: number };

/**
 * One PUT with progress, tried up to three times. Uses XMLHttpRequest rather
 * than fetch because fetch has no upload-progress API, and these files are
 * large enough that whoever is uploading needs to see movement or they'll
 * assume it has hung.
 */
async function putWithRetry(
  url: string,
  body: Blob,
  contentType: string | null,
  onBytes?: (loaded: number) => void
): Promise<PutResult> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= ATTEMPTS_PER_PIECE; attempt++) {
    const result = await new Promise<PutResult>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onBytes) onBytes(e.loaded);
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve({ ok: true, etag: xhr.getResponseHeader("ETag") })
          : resolve({ ok: false, status: xhr.status });
      xhr.onerror = () => resolve({ ok: false, status: 0 });
      xhr.open("PUT", url);
      // The header must be the type the SERVER signed, not the browser's
      // guess — a mismatch fails as a 403. Piece uploads sign no type at all,
      // so they send none.
      if (contentType) xhr.setRequestHeader("content-type", contentType);
      xhr.send(body);
    });
    if (result.ok) return result;
    lastStatus = result.status;
    // 4xx won't change on retry — signature, permission, or size problems.
    // Status 0 (connection dropped) and 5xx are exactly what retries are for.
    if (result.status > 0 && result.status < 500) return result;
    if (attempt < ATTEMPTS_PER_PIECE) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return { ok: false, status: lastStatus };
}

function describePutFailure(status: number): string {
  return status === 413
    ? "That file is too large to upload."
    : status === 401 || status === 403
      ? "You don't have permission to upload to this listing."
      : status === 0
        ? "The connection kept dropping — each piece was tried 3 times. Please try again."
        : `Upload failed (error ${status}).`;
}

export type PrivateBucketTarget = { listingId: string } | { galleryId: string };

export type PrivateBucketUploadResult =
  | { ok: true; path: string; playbackUrl: string | null }
  | { ok: false; error: string };

/**
 * Move one file from the browser into the private Cloudflare bucket, and say
 * where it landed. No database writes — callers record the row themselves,
 * since listings and galleries record different things.
 */
export async function uploadVideoToPrivateBucket(args: {
  file: File;
  target: PrivateBucketTarget;
  onProgress?: (percent: number) => void;
}): Promise<PrivateBucketUploadResult> {
  const { file, target, onProgress } = args;
  const contentType = file.type || "video/mp4";

  if (file.size > MULTIPART_THRESHOLD) {
    return uploadInPieces(file, target, contentType, onProgress);
  }

  // Small file: one signed PUT, retried. The server hands back a signed
  // address (checking access in the process) and decides the path itself.
  const ticketRes = await fetch("/api/videos/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...target, filename: file.name, contentType }),
  });
  const ticket = await ticketRes.json().catch(() => ({}));
  if (!ticketRes.ok || !ticket.url || !ticket.path) {
    return { ok: false, error: String(ticket.error ?? "Couldn't start the upload.") };
  }

  const put = await putWithRetry(
    ticket.url,
    file,
    String(ticket.contentType ?? contentType),
    (loaded) => onProgress?.(Math.round((loaded / file.size) * 100))
  );
  if (!put.ok) return { ok: false, error: describePutFailure(put.status) };

  return { ok: true, path: ticket.path, playbackUrl: (ticket.playbackUrl as string) ?? null };
}

/** The large-file path: numbered pieces, each retried on its own. */
async function uploadInPieces(
  file: File,
  target: PrivateBucketTarget,
  contentType: string,
  onProgress?: (percent: number) => void
): Promise<PrivateBucketUploadResult> {
  const startRes = await fetch("/api/videos/multipart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start", ...target, filename: file.name, contentType, totalBytes: file.size }),
  });
  const start = await startRes.json().catch(() => ({}));
  if (!startRes.ok || !start.uploadId || !Array.isArray(start.partUrls)) {
    return { ok: false, error: String(start.error ?? "Couldn't start the upload.") };
  }

  const partSize = Number(start.partSize);
  const parts: { PartNumber: number; ETag: string }[] = [];

  const abort = () =>
    fetch("/api/videos/multipart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "abort", ...target, path: start.path, uploadId: start.uploadId }),
    }).catch(() => {});

  for (let i = 0; i < start.partUrls.length; i++) {
    const from = i * partSize;
    // slice() with no type on purpose: an untyped piece sends no content-type
    // header, and the piece signatures cover none.
    const piece = file.slice(from, Math.min(from + partSize, file.size));

    const put = await putWithRetry(start.partUrls[i], piece, null, (loaded) =>
      onProgress?.(Math.round(((from + loaded) / file.size) * 100))
    );

    if (!put.ok) {
      await abort();
      return { ok: false, error: describePutFailure(put.status) };
    }
    if (!put.etag) {
      // Without the receipt the upload can't be assembled. This would mean the
      // bucket's CORS policy stopped exposing ETag — a setup problem, not a
      // connection one, so say so.
      await abort();
      return { ok: false, error: "The storage didn't acknowledge an uploaded piece (missing ETag). This is a bucket CORS setting, not your connection." };
    }
    parts.push({ PartNumber: i + 1, ETag: put.etag });
  }

  const doneRes = await fetch("/api/videos/multipart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "complete",
      ...target,
      path: start.path,
      uploadId: start.uploadId,
      parts,
      totalBytes: file.size,
    }),
  });
  const done = await doneRes.json().catch(() => ({}));
  if (!doneRes.ok || !done.done) {
    await abort();
    return { ok: false, error: String(done.error ?? "Couldn't finish the upload.") };
  }

  return { ok: true, path: start.path, playbackUrl: (start.playbackUrl as string) ?? null };
}

export interface UploadListingVideoArgs {
  supabase: SupabaseClient;
  file: File;
  listingId: string;
  /** Who is doing the uploading (may differ from the listing's owner). */
  uploadedBy: string;
  displayOrder: number;
  /** 0-100 for this single file. */
  onProgress?: (percent: number) => void;
}

export interface UploadedVideo {
  id: string;
  storage_path: string;
  filename: string | null;
  created_at: string;
  in_slideshow: boolean;
  thumbnail_path: string | null;
}

export type UploadListingVideoResult =
  | { ok: true; video: UploadedVideo; playbackUrl: string | null }
  | { ok: false; error: string };

export async function uploadListingVideo({
  supabase,
  file,
  listingId,
  uploadedBy,
  displayOrder,
  onProgress,
}: UploadListingVideoArgs): Promise<UploadListingVideoResult> {
  const uploaded = await uploadVideoToPrivateBucket({ file, target: { listingId }, onProgress });
  if (!uploaded.ok) return uploaded;
  const path = uploaded.path;

  const { data: row, error: insertError } = await supabase
    .from("videos")
    .insert({
      listing_id: listingId,
      storage_path: path,
      storage_host: "r2",
      filename: file.name,
      uploaded_by: uploadedBy,
      display_order: displayOrder,
    })
    .select("id, storage_path, filename, created_at, in_slideshow, thumbnail_path")
    .single();

  if (insertError || !row) {
    // The file reached Cloudflare but we can't record it. The browser can't
    // delete from the private bucket, so report plainly — an orphaned file is
    // a cost problem, a silent vanish is a trust problem.
    return { ok: false, error: insertError?.message ?? "Couldn't save the video record." };
  }

  const video = row as UploadedVideo;

  // Still frame, best-effort and strictly after the fact. A missing cover is
  // cosmetic; it must never fail the upload or hold up the progress bar.
  try {
    const poster = await captureVideoPoster(file);
    if (poster) {
      // Derived from the video's own path so the still sits beside it in the
      // listing owner's folder.
      const posterPath = `${path.substring(0, path.lastIndexOf("/"))}/video-still-${Date.now()}.jpg`;
      const { error: posterError } = await supabase.storage
        .from("listing-photos")
        .upload(posterPath, poster, { upsert: false, contentType: "image/jpeg" });
      if (!posterError) {
        const { error: linkError } = await supabase
          .from("videos")
          .update({ thumbnail_path: posterPath })
          .eq("id", video.id);
        if (linkError) {
          await supabase.storage.from("listing-photos").remove([posterPath]);
        } else {
          video.thumbnail_path = posterPath;
        }
      }
    }
  } catch {
    /* no poster; the listing falls back to whatever else it has */
  }

  return { ok: true, video, playbackUrl: uploaded.playbackUrl };
}
