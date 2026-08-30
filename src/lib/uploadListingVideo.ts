import type { SupabaseClient } from "@supabase/supabase-js";
import { captureVideoPoster } from "./captureVideoPoster";

/**
 * Upload one video to a listing, with a still frame captured for its cover.
 *
 * Videos can be added in three places — the broker create form, the admin
 * create form, and the listing's Manage page — and they were drifting apart.
 * This is the single path all three use, so a change made once applies
 * everywhere.
 *
 * Uses XMLHttpRequest rather than fetch because fetch has no upload-progress
 * API, and these files are large enough that a broker needs to see movement or
 * they'll assume it has hung.
 *
 * Order of operations matters here:
 *  1. video uploads first, so progress starts moving immediately
 *  2. the database row is written
 *  3. the still is captured and attached afterwards
 *
 * Capturing the still first seemed tidier, but it meant up to ten seconds of a
 * frozen progress bar before a byte moved — the exact "is this thing working?"
 * problem the progress bar exists to prevent. Doing it last also means a failed
 * upload can't leave an orphaned still sitting in storage with nothing pointing
 * at it.
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
  const contentType = file.type || "video/mp4";

  // New video goes straight to the private Cloudflare bucket — this is what
  // stops Supabase storage growing. The server hands back a signed upload
  // address (checking listing access in the process) and decides the path
  // itself, filed under the listing owner's id so an assistant's or admin's
  // uploads stay with the rest of the broker's media.
  const ticketRes = await fetch("/api/videos/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listingId, filename: file.name, contentType }),
  });
  const ticket = await ticketRes.json().catch(() => ({}));
  if (!ticketRes.ok || !ticket.url || !ticket.path) {
    return { ok: false, error: String(ticket.error ?? "Couldn't start the upload.") };
  }
  const path: string = ticket.path;

  const outcome = await new Promise<{ ok: boolean; status: number }>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    // PUT to the signed address. The content type must match what was signed —
    // it's part of the signature.
    xhr.open("PUT", ticket.url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.send(file);
  });

  if (!outcome.ok) {
    // Say which failure it was. "Too large" and "connection dropped" call for
    // completely different responses from whoever is uploading.
    const error =
      outcome.status === 413 ? "That file is too large to upload."
      : outcome.status === 401 || outcome.status === 403 ? "You don't have permission to upload to this listing."
      : outcome.status === 0 ? "The connection dropped during upload."
      : `Upload failed (error ${outcome.status}).`;
    return { ok: false, error };
  }

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

  return { ok: true, video, playbackUrl: (ticket.playbackUrl as string) ?? null };
}
