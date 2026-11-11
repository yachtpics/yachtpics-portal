"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { signOriginalsInBrowser } from "@/lib/photoStoreClient";

/**
 * Download links at a chosen size for photos of one listing — the ONE copy of
 * the signing loop, used by the listing page (useSizedDownloads) and the
 * My Listings row's Photos button (ListingRow).
 *
 * Links come from POST /api/listings/[id]/photos/download-urls, signed at
 * download time. Files still being made come back as `pending` and are asked
 * for again (up to 6 rounds). Nov 11 (41 Bahama): for Web & MLS / Social, any
 * photo still without a link afterwards — the route failed, timed out, or
 * left it out — falls back to its ORIGINAL, signed here as the Full path
 * does, so a download never ends with nothing. Those ids (and the ones the
 * route itself served as originals) are in `original`: name them with the
 * original's extension and no size suffix.
 */
export type SignedDownloads = {
  urls: Record<string, string>;
  /** Extension of a pre-made R2 file (jpg / png); absent = the original's own. */
  ext: Record<string, string>;
  bytes: Record<string, number>;
  /** Photos coming down at full size because their sized copy couldn't be had. */
  original: string[];
};

/** One route call may run up to ~50 s (making missing files); give up a little after Vercel's 60 s. */
const ROUTE_TIMEOUT_MS = 70_000;

export async function signPhotosForDownload(
  listingId: string,
  targets: { id: string; storage_path: string }[],
  size: "full" | "web" | "social",
  supabase: SupabaseClient
): Promise<SignedDownloads> {
  const urls: Record<string, string> = {};
  const ext: Record<string, string> = {};
  const bytes: Record<string, number> = {};
  const originalIds: Record<string, true> = {};
  let ask = targets.map((t) => t.id);
  for (let attempt = 0; ask.length > 0 && attempt < 6; attempt++) {
    let pending: string[] = [];
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ROUTE_TIMEOUT_MS) : null;
    try {
      const res = await fetch(`/api/listings/${listingId}/photos/download-urls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: ask, size }),
        ...(ctl ? { signal: ctl.signal } : {}),
      });
      if (!res.ok) break;
      const d = await res.json().catch(() => null);
      if (!d) break;
      Object.assign(urls, (d.urls ?? {}) as Record<string, string>);
      Object.assign(ext, (d.ext ?? {}) as Record<string, string>);
      Object.assign(bytes, (d.bytes ?? {}) as Record<string, number>);
      if (Array.isArray(d.original)) (d.original as string[]).forEach((id) => { originalIds[id] = true; });
      pending = Array.isArray(d.pending) ? (d.pending as string[]) : [];
    } catch {
      break;
    } finally {
      if (timer) clearTimeout(timer);
    }
    ask = pending;
  }

  // Sized downloads: whatever is still missing comes down as the original.
  // (Full resolution is the originals already — left exactly as it was.)
  if (size !== "full") {
    const missing = targets.filter((t) => !urls[t.id] && !!t.storage_path);
    if (missing.length > 0) {
      try {
        const signed = await signOriginalsInBrowser(supabase, missing.map((t) => t.storage_path), 3600);
        missing.forEach((t) => {
          const u = signed.get(t.storage_path);
          if (!u) return;
          urls[t.id] = u;
          originalIds[t.id] = true;
          delete ext[t.id];
          delete bytes[t.id]; // unknown — the zip measures it
        });
      } catch { /* left without a link: counted as failed by the caller */ }
    }
  }

  return { urls, ext, bytes, original: Object.keys(originalIds).filter((id) => !!urls[id]) };
}

/** "5 photos were saved at full size." (empty when none). */
export function fullSizeNote(n: number): string {
  if (n <= 0) return "";
  return `${n} photo${n !== 1 ? "s were" : " was"} saved at full size.`;
}
