/**
 * Upload caps for the FILMING account (the writable demo — src/lib/demo.ts),
 * Nov 12, 2026. Server only.
 *
 * The filming account may hold at most FILMING_MAX_PHOTOS photos and
 * FILMING_MAX_BYTES of stored media across all its listings. The upload
 * routes that hand out storage links (photo upload-target, video upload-url /
 * multipart start) call demoRwUploadRefusal() before signing anything; the
 * photos trigger in migration 20261112_demo_rw_filming_account.sql is the
 * backstop for the photo count and declared bytes, and the storage.objects
 * policy caps direct Supabase uploads by object count and size.
 *
 * What it counts (cheap enough for one small account, run only for it):
 *   photos — rows on the account's listings;
 *   bytes  — R2 objects under the account's own prefix in the photo bucket
 *            (`photos/listing-photos/{userId}/`) and the video bucket
 *            (`{userId}/`), plus `original_bytes` of photos stored on
 *            Supabase. Links already handed out but not yet used aren't
 *            counted; a per-instance rate limit keeps that window small.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { r2, R2_VIDEO_BUCKET, r2VideoConfigured } from "@/lib/r2";
import { R2_PHOTO_BUCKET, r2PhotoKey, r2PhotosConfigured } from "@/lib/photoStore";
import { DEMO_BLOCK_HEADER, FILMING_MAX_BYTES, FILMING_MAX_PHOTOS, isWritableDemoUser } from "@/lib/demo";
import { rateLimited } from "@/lib/simpleRateLimit";

const isUuid = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x);

async function r2PrefixBytes(bucket: string, prefix: string): Promise<number> {
  let total = 0;
  let token: string | undefined;
  let pages = 0;
  do {
    const res = await r2().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    (res.Contents ?? []).forEach((o) => { total += Number(o.Size ?? 0); });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
    pages++;
  } while (token && pages < 50);
  return total;
}

export type FilmingUsage = { photos: number; bytes: number };

/** Current photo count and stored bytes of the filming account. */
export async function filmingUsage(svc: SupabaseClient, userId: string): Promise<FilmingUsage> {
  if (!isUuid(userId)) throw new Error("bad user id");
  const { data: ls, error: lErr } = await svc.from("listings").select("id").eq("broker_id", userId);
  if (lErr) throw new Error(lErr.message);
  const listingIds = ((ls ?? []) as { id: string }[]).map((l) => l.id);
  let photos = 0;
  let supaBytes = 0;
  if (listingIds.length) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await svc
        .from("photos")
        .select("original_bytes, storage_backend")
        .in("listing_id", listingIds)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { original_bytes: number | null; storage_backend: string | null }[];
      photos += rows.length;
      rows.forEach((r) => { if (r.storage_backend !== "r2") supaBytes += Number(r.original_bytes ?? 0); });
      if (rows.length < 1000) break;
    }
  }
  const [photoR2, videoR2] = await Promise.all([
    r2PhotosConfigured() ? r2PrefixBytes(R2_PHOTO_BUCKET, r2PhotoKey(`${userId}/`)) : Promise.resolve(0),
    r2VideoConfigured() ? r2PrefixBytes(R2_VIDEO_BUCKET, `${userId}/`) : Promise.resolve(0),
  ]);
  return { photos, bytes: supaBytes + photoR2 + videoR2 };
}

/**
 * Always 403: the photo uploader treats any other refusal from upload-target
 * as "R2 unavailable" and falls back to a direct Supabase upload.
 */
function refuse(error: string): NextResponse {
  return NextResponse.json({ error, demo: true }, { status: 403, headers: { [DEMO_BLOCK_HEADER]: "1", "Cache-Control": "no-store" } });
}

/**
 * For the filming account only (anyone else → null, nothing counted): a
 * refusal when this upload would go over the caps, else null. `kind` "photo"
 * also checks the photo count; `addBytes` is the declared size (0 if unknown).
 * Fails CLOSED for the filming account — if usage can't be read, no link.
 */
export async function demoRwUploadRefusal(
  svc: SupabaseClient,
  user: { id: string; app_metadata?: Record<string, unknown> | null } | null | undefined,
  kind: "photo" | "video",
  addBytes: number
): Promise<NextResponse | null> {
  if (!user || !isWritableDemoUser(user)) return null;
  // ~3 links a second sustained is plenty for a filmed upload of 300 photos.
  if (rateLimited(`demo-rw-upload:${user.id}`, 600, 10 * 60_000)) {
    return refuse("Too many uploads at once on the filming account — wait a minute.");
  }
  let usage: FilmingUsage;
  try {
    usage = await filmingUsage(svc, user.id);
  } catch (e) {
    console.error("[demo-rw] usage check failed:", e instanceof Error ? e.message : String(e));
    return refuse("Couldn't check the filming account's storage — try again.");
  }
  if (kind === "photo" && usage.photos >= FILMING_MAX_PHOTOS) {
    return refuse(`The filming account is full (${FILMING_MAX_PHOTOS} photos). Reset it to start again.`);
  }
  const add = Number.isFinite(addBytes) && addBytes > 0 ? addBytes : 0;
  if (usage.bytes + add > FILMING_MAX_BYTES) {
    return refuse(`The filming account is full (${Math.round(FILMING_MAX_BYTES / 1024 ** 3)} GB). Reset it to start again.`);
  }
  return null;
}

/**
 * Filming account + a listing id from a request body: null when the caller
 * isn't the filming account or the listing is its own; else a 403. (Admin-only
 * upload targets — galleries, Reel Service, social — are refused for it by
 * their own role checks as well.)
 */
export async function demoRwListingOwnerRefusal(
  svc: SupabaseClient,
  user: { id: string; app_metadata?: Record<string, unknown> | null } | null | undefined,
  listingId: unknown
): Promise<NextResponse | null> {
  if (!user || !isWritableDemoUser(user)) return null;
  if (!isUuid(listingId)) return refuse("The filming account can only upload to its own listings.");
  const { data } = await svc.from("listings").select("broker_id").eq("id", listingId).maybeSingle();
  if (!data || data.broker_id !== user.id) return refuse("The filming account can only upload to its own listings.");
  return null;
}
