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
  return { ok: true, row: row as ListingPhotoRow };
}
