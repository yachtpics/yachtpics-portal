import type { SupabaseClient } from "@supabase/supabase-js";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { R2_BUCKET, r2, r2Configured, r2Put, r2PublicUrl } from "@/lib/r2";
import { derivativePath, hasDerivatives } from "@/lib/photoDerivativePaths";
import { PHOTO_BUCKET, readOriginal } from "@/lib/photoStore";
import { loadSharp } from "@/lib/photoSharp";

/**
 * Email-safe cover images (Oct 29) — SERVER ONLY.
 *
 * Mail clients (Outlook especially, and some Gmail paths) won't show WebP, and
 * a signed link to the private photo bucket expires or breaks once originals
 * move. So an email image is a ~1200px JPEG (q82) made with sharp, uploaded
 * once to a PUBLIC location and reused:
 *   R2 public media host (R2_PUBLIC_BASE_URL)  email/{folder}/{listingId}/{photoId}-{ver}-{w}x{h}.jpg
 *   else Supabase public bucket portal-assets  same key
 * The width/height ride in the file name so a reuse needs no extra lookup.
 * The {photoId}-{ver} part changes when the cover photo (or its file) changes.
 * Source: the 2000px derivative, else the original wherever it lives
 * (readOriginal handles R2). Any failure returns null — callers send without
 * the image rather than block.
 */

const EMAIL_WIDTH = 1200;
const EMAIL_QUALITY = 82;
const PUBLIC_BUCKET = "portal-assets";

export type EmailImage = { url: string; width: number; height: number };

type CoverPhoto = { id: string; storage_path: string; storage_backend?: string | null; derivatives_at?: string | null };

const memo = new Map<string, EmailImage>();

function dimsFrom(name: string): { width: number; height: number } | null {
  const m = /-(\d+)x(\d+)\.jpg$/.exec(name);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

function supabasePublicUrl(svc: SupabaseClient, key: string): string {
  return svc.storage.from(PUBLIC_BUCKET).getPublicUrl(key).data.publicUrl;
}

async function findExisting(svc: SupabaseClient, prefix: string): Promise<EmailImage | null> {
  if (r2Configured()) {
    const res = await r2().send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, MaxKeys: 5 }));
    for (const o of res.Contents ?? []) {
      const d = o.Key ? dimsFrom(o.Key) : null;
      if (o.Key && d) return { url: r2PublicUrl(o.Key), ...d };
    }
    return null;
  }
  const slash = prefix.lastIndexOf("/");
  const dir = prefix.slice(0, slash);
  const base = prefix.slice(slash + 1);
  const { data } = await svc.storage.from(PUBLIC_BUCKET).list(dir, { search: base, limit: 5 });
  for (const f of data ?? []) {
    const d = f.name.startsWith(base) ? dimsFrom(f.name) : null;
    if (d) return { url: supabasePublicUrl(svc, `${dir}/${f.name}`), ...d };
  }
  return null;
}

async function sourceBytes(svc: SupabaseClient, photo: CoverPhoto): Promise<Uint8Array> {
  if (hasDerivatives(photo)) {
    const { data } = await svc.storage.from(PHOTO_BUCKET).download(derivativePath(photo, 2000));
    if (data) return new Uint8Array(await data.arrayBuffer());
  }
  return (await readOriginal(svc, { storage_path: photo.storage_path, storage_backend: photo.storage_backend ?? null })).bytes;
}

/** A public, long-lived JPEG of this photo for an email; null if anything fails. */
export async function emailCoverImage(svc: SupabaseClient, folder: string, listingId: string, photo: CoverPhoto): Promise<EmailImage | null> {
  try {
    // {photoId}-{ver} from the derivative name: it changes with the file.
    const tag = (derivativePath(photo, 2000).split("/").pop() ?? photo.id).replace(/-2000\.webp$/, "");
    const prefix = `email/${folder}/${listingId}/${tag}-`;
    const hit = memo.get(prefix);
    if (hit) return hit;

    const existing = await findExisting(svc, prefix);
    if (existing) {
      memo.set(prefix, existing);
      return existing;
    }

    const sharp = await loadSharp();
    if (!sharp) return null;
    const input = await sourceBytes(svc, photo);
    const { data: jpeg, info } = await sharp(Buffer.from(input.buffer, input.byteOffset, input.byteLength), { failOn: "none" })
      .rotate()
      .resize({ width: EMAIL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: EMAIL_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const key = `${prefix}${info.width}x${info.height}.jpg`;

    let url: string;
    if (r2Configured()) {
      await r2Put(key, jpeg, "image/jpeg");
      url = r2PublicUrl(key);
    } else {
      const { error } = await svc.storage.from(PUBLIC_BUCKET).upload(key, jpeg, { contentType: "image/jpeg", cacheControl: "31536000", upsert: true });
      if (error) return null;
      url = supabasePublicUrl(svc, key);
    }
    const out = { url, width: info.width, height: info.height };
    memo.set(prefix, out);
    return out;
  } catch (e) {
    console.warn("emailCoverImage failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
