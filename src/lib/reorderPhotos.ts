import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Save a listing's photo order in ONE request.
 *
 * Writes display_order = position (0-based) for every id, in the order given,
 * via the `reorder_photos` database function (migration 20261018d). It runs as
 * the signed-in user (security invoker), so row-level security still decides
 * which photos they may change — exactly as the per-photo updates did.
 *
 * Until that migration is applied the function won't exist, so on any RPC
 * error this falls back to the old one-update-per-photo path. Remove the
 * fallback once the migration is live everywhere.
 */
export async function reorderPhotos(
  supabase: SupabaseClient,
  listingId: string,
  photoIds: string[]
): Promise<{ error: string | null }> {
  if (photoIds.length === 0) return { error: null };

  const { error } = await supabase.rpc("reorder_photos", {
    p_listing_id: listingId,
    p_photo_ids: photoIds,
  });
  if (!error) return { error: null };

  const results = await Promise.all(
    photoIds.map((photoId, idx) =>
      supabase.from("photos").update({ display_order: idx }).eq("id", photoId).eq("listing_id", listingId)
    )
  );
  const failed = results.find((r) => r.error);
  return { error: failed?.error?.message ?? null };
}
