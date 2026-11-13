import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The broker logo file — shared by the broker's own upload (My Profile →
 * POST /api/logo/upload) and the admin's (Admin → Brokers → a broker →
 * Logo → POST /api/admin/brokers/[id]/logo), so both store exactly the same
 * thing: `broker-logos/{brokerId}/logo.{ext}` (public bucket, upserted) and a
 * cache-busted public URL that the caller writes to `broker_details.logo_url`.
 * The file is stored as uploaded — no trim, resize or format change.
 */

export const LOGO_BUCKET = "broker-logos";

// Only these image types are accepted; the stored file's extension comes from
// the type, never from the uploaded filename.
export const ALLOWED_LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

/** The error text for a file that can't be a logo, or null when it's fine. */
export function logoFileError(file: { type: string; size: number }): string | null {
  if (!ALLOWED_LOGO_TYPES[file.type]) return "Logo must be a PNG, JPG or WebP image.";
  if (file.size > MAX_LOGO_BYTES) return "Logo is too large — please use an image under 2 MB.";
  return null;
}

/**
 * Upload the (already validated) file to the broker's own folder with the
 * service-role client and return the public URL to store, or an error message.
 */
export async function storeBrokerLogoFile(
  svc: SupabaseClient,
  brokerId: string,
  file: File
): Promise<{ url: string; error?: undefined } | { error: string; url?: undefined }> {
  const ext = ALLOWED_LOGO_TYPES[file.type];
  if (!ext) return { error: "Logo must be a PNG, JPG or WebP image." };
  const path = `${brokerId}/logo.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await svc.storage
    .from(LOGO_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (uploadError) return { error: `Storage upload failed: ${uploadError.message}` };

  const { data: urlData } = svc.storage.from(LOGO_BUCKET).getPublicUrl(path);
  return { url: `${urlData.publicUrl}?t=${Date.now()}` };
}
