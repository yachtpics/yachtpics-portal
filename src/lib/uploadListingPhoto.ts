import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Run `worker` over `items`, at most `limit` at a time. Each worker gets the
 * item's ORIGINAL index, so anything order-dependent (display_order, file
 * names) is decided by the caller's order, never by which upload finishes
 * first. Resolves once every item has settled; a worker that throws is the
 * caller's problem to catch — this never rejects early and strands the rest.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        await worker(items[i], i);
      } catch {
        /* the worker reports its own failure */
      }
    }
  });
  await Promise.all(lanes);
}

/**
 * Ask the server to make the stored 600 / 2000 px WebP copies of freshly
 * uploaded (or replaced) photos — fire-and-forget. Ids are gathered per
 * listing and sent in small batches (8 at once, or after 1.5 s of quiet) to
 * POST /api/listings/[id]/photos/derivatives, with `keepalive` so a page
 * change doesn't cancel them. If a request never lands, nothing breaks: pages
 * fall back to on-the-fly resizing and the daily backfill catches the photo.
 */
const derivativeQueue = new Map<string, { ids: Set<string>; timer: ReturnType<typeof setTimeout> | null }>();
let derivativePagehideHooked = false;

function flushDerivatives(listingId: string) {
  const entry = derivativeQueue.get(listingId);
  if (!entry) return;
  derivativeQueue.delete(listingId);
  if (entry.timer) clearTimeout(entry.timer);
  const ids = Array.from(entry.ids);
  for (let i = 0; i < ids.length; i += 40) {
    try {
      fetch(`/api/listings/${listingId}/photos/derivatives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: ids.slice(i, i + 40) }),
        keepalive: true,
      }).catch(() => { /* the daily backfill catches it */ });
    } catch {
      /* ignore */
    }
  }
}

export function requestDerivatives(listingId: string, photoIds: string[]) {
  if (typeof window === "undefined" || !listingId || photoIds.length === 0) return;
  if (!derivativePagehideHooked) {
    derivativePagehideHooked = true;
    window.addEventListener("pagehide", () => {
      Array.from(derivativeQueue.keys()).forEach(flushDerivatives);
    });
  }
  const entry = derivativeQueue.get(listingId) ?? { ids: new Set<string>(), timer: null };
  photoIds.forEach((id) => entry.ids.add(id));
  derivativeQueue.set(listingId, entry);
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  if (entry.ids.size >= 8) {
    flushDerivatives(listingId);
  } else {
    entry.timer = setTimeout(() => flushDerivatives(listingId), 1500);
  }
}

/** How many listing photos upload at once (admin pages). */
export const PHOTO_UPLOAD_CONCURRENCY = 4;

export type ListingPhotoRow = {
  id: string;
  storage_path: string;
  filename: string | null;
  category: string | null;
  display_order: number;
  is_visible: boolean;
};

/**
 * The per-file pipeline: upload to storage → insert the photos row. If the
 * file lands but the row can't be written, the storage object is removed so
 * no orphan file is left behind with nothing pointing at it.
 */
export async function uploadListingPhoto(opts: {
  supabase: SupabaseClient;
  file: File;
  brokerId: string;
  listingId: string;
  /** Unique within the batch — goes into the storage file name. */
  pathKey: string;
  category: string;
  displayOrder: number;
  uploadedBy: string | null;
}): Promise<{ ok: true; row: ListingPhotoRow } | { ok: false; error: string }> {
  const { supabase, file, brokerId, listingId, pathKey, category, displayOrder, uploadedBy } = opts;
  const ext = file.name.split(".").pop();
  const path = `${brokerId}/${listingId}/${pathKey}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("listing-photos")
    .upload(path, file, { upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { data: row, error: insertError } = await supabase
    .from("photos")
    .insert({
      listing_id: listingId,
      storage_path: path,
      filename: file.name,
      category,
      display_order: displayOrder,
      is_visible: true,
      uploaded_by: uploadedBy,
    })
    .select()
    .single();

  if (insertError || !row) {
    await supabase.storage.from("listing-photos").remove([path]).then(() => {}, () => {});
    return { ok: false, error: insertError?.message ?? "Couldn't save the photo record." };
  }
  requestDerivatives(listingId, [(row as ListingPhotoRow).id]);
  return { ok: true, row: row as ListingPhotoRow };
}

export type ReplacedPhoto = {
  id: string;
  storage_path: string;
  filename: string | null;
  /** Fresh 400px thumbnail for the NEW file (new path = no stale cache). */
  thumbUrl: string | null;
  /** Fresh signed full-size link for the new file (1 hour). */
  originalUrl: string | null;
};

/**
 * Swap the file behind an existing photo, keeping everything else about it —
 * its id, place in the order, category and cover-photo status.
 *
 * The new file goes to a NEW storage path (never overwritten in place: the CDN
 * and thumbnail caches would keep showing the old picture), then the server
 * route repoints the photos row and removes the old file. If the server
 * refuses, the just-uploaded file is removed again so nothing is orphaned.
 *
 * The file goes straight to storage from the browser (originals are often
 * larger than a server route will accept); only the swap goes through
 * `/api/listings/[id]/photos/[photoId]/replace`, which re-checks access.
 */
export async function replaceListingPhoto(opts: {
  supabase: SupabaseClient;
  file: File;
  /** First folder of the storage path: the listing's broker (admin page) or
   *  the signed-in uploader (broker page) — same as a normal upload there. */
  ownerFolder: string;
  listingId: string;
  photoId: string;
  onStage?: (stage: "uploading" | "saving") => void;
}): Promise<{ ok: true; photo: ReplacedPhoto } | { ok: false; error: string }> {
  const { supabase, file, ownerFolder, listingId, photoId, onStage } = opts;
  if (!file.type.startsWith("image/")) return { ok: false, error: "That file isn't a photo." };
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${ownerFolder}/${listingId}/${Date.now()}-r${Math.random().toString(36).slice(2, 8)}.${ext}`;

  onStage?.("uploading");
  const { error: uploadError } = await supabase.storage
    .from("listing-photos")
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (uploadError) return { ok: false, error: uploadError.message };

  onStage?.("saving");
  let res: Response;
  try {
    res = await fetch(`/api/listings/${listingId}/photos/${photoId}/replace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPath: path, filename: file.name }),
    });
  } catch (e) {
    await supabase.storage.from("listing-photos").remove([path]).then(() => {}, () => {});
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.photo) {
    await supabase.storage.from("listing-photos").remove([path]).then(() => {}, () => {});
    return { ok: false, error: data?.error ?? `The server answered ${res.status}` };
  }
  // The replace route cleared derivatives_at and removed the old copies;
  // make the new file's copies now.
  requestDerivatives(listingId, [photoId]);
  return { ok: true, photo: data.photo as ReplacedPhoto };
}
