import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { newOriginalsBackend, r2PhotosConfigured, R2_PHOTO_BUCKET } from "@/lib/photoStore";
import { sitePhotosBackend } from "@/lib/sitePublish";
import { r2Configured } from "@/lib/r2";
import { CLEANUP_CONFIRM_PHRASE } from "@/lib/jobs/photoMigration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/storage → where photo originals live, in counts and bytes
 * (public.photo_storage_stats(), migration 20261028c_photo_originals_r2.sql),
 * plus where new uploads and website photos go right now. Admin only;
 * read-only.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { data, error } = await auth.admin.rpc("photo_storage_stats");
  if (error) {
    return NextResponse.json(
      { error: /photo_storage_stats/.test(error.message) ? "Apply migration 20261028c_photo_originals_r2.sql first." : error.message },
      { status: 503 }
    );
  }
  return NextResponse.json({
    stats: data,
    config: {
      newUploads: newOriginalsBackend(),
      websitePhotos: sitePhotosBackend(),
      r2Photos: r2PhotosConfigured(),
      r2PhotoBucket: R2_PHOTO_BUCKET,
      r2Public: r2Configured(),
    },
    confirmPhrase: CLEANUP_CONFIRM_PHRASE,
  });
}
