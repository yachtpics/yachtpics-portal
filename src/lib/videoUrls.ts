import type { SupabaseClient } from "@supabase/supabase-js";
import { r2SignedGetUrl, r2VideoConfigured } from "./r2";

/**
 * One place that answers "where does this video live, and what's its URL?"
 *
 * Video is moving off Supabase to a private Cloudflare bucket, file by file.
 * During that move both homes are live at once, and roughly fourteen places in
 * the app need a playable link — the listing page, the admin page, galleries,
 * client galleries, the public download pages, the public slideshows, and the
 * send-to-client email.
 *
 * Changing fourteen call sites to each branch on storage_host would be fourteen
 * chances to get it subtly wrong, and several of those links are already in
 * clients' inboxes. So they all call this instead. The branching lives here,
 * once, and the migration flips rows underneath without any of them noticing.
 *
 * Both stores use the same key, so a migrated file keeps its path — only the
 * bucket it's read from changes.
 */

/** Minimum a caller must select for us to sign a video. */
export type SignableVideo = {
  id: string;
  storage_path: string;
  storage_host?: string | null;
  filename?: string | null;
};

/** Six hours: long enough for a broker to start a big download and not lose it. */
const DEFAULT_TTL = 60 * 60 * 6;

function isOnR2(v: SignableVideo): boolean {
  return v.storage_host === "r2";
}

/**
 * Sign a batch, returning a map keyed by video id.
 *
 * Keyed by id rather than path because paths are only unique per bucket, and
 * during the migration a caller can hold rows from both.
 */
export async function signVideoUrls(
  supabase: SupabaseClient,
  videos: SignableVideo[],
  opts: { expiresIn?: number } = {}
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (videos.length === 0) return out;

  const ttl = opts.expiresIn ?? DEFAULT_TTL;
  const onSupabase = videos.filter((v) => !isOnR2(v));
  const onR2 = videos.filter(isOnR2);

  // Supabase signs a whole batch in one call.
  if (onSupabase.length > 0) {
    const { data } = await supabase.storage
      .from("listing-videos")
      .createSignedUrls(onSupabase.map((v) => v.storage_path), ttl);
    const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl] as const));
    for (const v of onSupabase) {
      const url = byPath.get(v.storage_path);
      if (url) out.set(v.id, url);
    }
  }

  // R2 signs one at a time, so these go in parallel.
  if (onR2.length > 0 && r2VideoConfigured()) {
    await Promise.all(
      onR2.map(async (v) => {
        try {
          out.set(v.id, await r2SignedGetUrl(v.storage_path, { expiresIn: ttl }));
        } catch {
          /* leave it unsigned rather than failing the whole page */
        }
      })
    );
  }

  return out;
}

/**
 * Sign one video, optionally as a download with its original filename.
 *
 * `downloadAs` matters: without it a browser saves the storage key, which is a
 * timestamped path nobody wants on their desktop.
 */
export async function signVideoUrl(
  supabase: SupabaseClient,
  video: SignableVideo,
  opts: { expiresIn?: number; asDownload?: boolean } = {}
): Promise<string | null> {
  const ttl = opts.expiresIn ?? DEFAULT_TTL;
  const name = opts.asDownload ? video.filename ?? undefined : undefined;

  if (isOnR2(video)) {
    if (!r2VideoConfigured()) return null;
    try {
      return await r2SignedGetUrl(video.storage_path, { expiresIn: ttl, downloadAs: name });
    } catch {
      return null;
    }
  }

  const { data } = await supabase.storage
    .from("listing-videos")
    .createSignedUrl(video.storage_path, ttl, name ? { download: name } : undefined);
  return data?.signedUrl ?? null;
}

/**
 * Attach a `url` to each row, preserving order.
 *
 * Most call sites want exactly this, and several were building the same
 * path→url map by hand — one of them by array index, which silently mismatched
 * if the storage call skipped a file.
 */
export async function withVideoUrls<T extends SignableVideo>(
  supabase: SupabaseClient,
  videos: T[],
  opts: { expiresIn?: number } = {}
): Promise<(T & { url: string | null })[]> {
  const urls = await signVideoUrls(supabase, videos, opts);
  return videos.map((v) => ({ ...v, url: urls.get(v.id) ?? null }));
}

/** Columns every caller must select for the helpers above to work. */
export const VIDEO_URL_COLUMNS = "id, storage_path, storage_host, filename";
