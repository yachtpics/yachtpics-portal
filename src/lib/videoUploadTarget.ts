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
  | { path: string; prefix: string }
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

export async function resolveVideoUploadTarget(
  svc: SupabaseClient,
  userId: string,
  body: { listingId?: unknown; galleryId?: unknown; filename?: unknown }
): Promise<VideoUploadTarget> {
  const filename = sanitizeVideoFilename(body?.filename);

  if (body?.listingId && typeof body.listingId === "string") {
    const access = await assertListingAccess(svc, body.listingId, userId, { includeCoBroker: true });
    if (access instanceof NextResponse) return access;

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
  body: { listingId?: unknown; galleryId?: unknown },
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
