import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The deletion log: one row for every photo or video that leaves the portal.
 *
 * Exists because of a real support mystery — "was there ever a video on this
 * boat?" — that took an hour of database archaeology to answer, because a
 * deleted video takes its whole record with it. The log answers it in one
 * glance instead.
 *
 * Everything is SNAPSHOTTED AS TEXT at the moment of deletion (names, not
 * ids-to-join-later), because the listing, gallery, or user a row refers to
 * may itself be deleted afterwards. A log you can only read by joining to
 * things that still exist isn't a log.
 *
 * Best-effort by design: a failure to write the log must never turn a
 * successful delete into an error the broker has to interpret.
 */
export type MediaDeletionEvent = {
  mediaType: "video" | "photo";
  actorId?: string | null;
  listingId?: string | null;
  galleryId?: string | null;
  /** Vessel or gallery name at the time. */
  contextName?: string | null;
  brokerName?: string | null;
  filename?: string | null;
  storagePath?: string | null;
  storageHost?: string | null;
  bytes?: number | null;
  /** For bulk photo deletes: one row covering N photos. */
  photoCount?: number | null;
  uploadedAt?: string | null;
  uploadedByName?: string | null;
  extra?: Record<string, unknown>;
};

export async function logMediaDeletion(svc: SupabaseClient, ev: MediaDeletionEvent): Promise<void> {
  try {
    let actorName: string | null = null;
    let actorRole: string | null = null;
    if (ev.actorId) {
      const { data: actor } = await svc
        .from("profiles")
        .select("first_name, last_name, role")
        .eq("id", ev.actorId)
        .maybeSingle();
      if (actor) {
        actorName = [actor.first_name, actor.last_name].filter(Boolean).join(" ") || null;
        actorRole = actor.role ?? null;
      }
    }
    await svc.from("media_deletions").insert({
      media_type: ev.mediaType,
      actor_id: ev.actorId ?? null,
      actor_name: actorName,
      actor_role: actorRole,
      listing_id: ev.listingId ?? null,
      gallery_id: ev.galleryId ?? null,
      context_name: ev.contextName ?? null,
      broker_name: ev.brokerName ?? null,
      filename: ev.filename ?? null,
      storage_path: ev.storagePath ?? null,
      storage_host: ev.storageHost ?? null,
      bytes: ev.bytes ?? null,
      photo_count: ev.photoCount ?? null,
      uploaded_at: ev.uploadedAt ?? null,
      uploaded_by_name: ev.uploadedByName ?? null,
      extra: ev.extra ?? {},
    });
  } catch {
    /* the delete already happened; the log must not fail it */
  }
}

/** "Sunseeker Above & Beyond" from a listing row, best effort. */
export function listingDisplayName(l: { vessel_name?: string | null; make?: string | null; model?: string | null } | null): string | null {
  if (!l) return null;
  return [l.make, l.model, l.vessel_name].filter(Boolean).join(" ") || null;
}

/** Person's display name from a profile row, best effort. */
export function profileDisplayName(p: { first_name?: string | null; last_name?: string | null } | null): string | null {
  if (!p) return null;
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || null;
}
