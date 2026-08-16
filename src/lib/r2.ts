import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 — where video for the public website lives.
 *
 * Why R2 rather than Supabase, which holds everything else: bandwidth. Supabase
 * charges for egress beyond the included allowance, and a boat page that streams
 * a 300MB clip to every visitor is exactly the kind of thing that runs up a bill
 * you don't see coming. R2 charges nothing for egress at all. It also takes the
 * video weight off the Supabase storage quota, which the video library was well
 * on its way to filling.
 *
 * R2 speaks the S3 API, so this is the standard AWS client pointed at a
 * different endpoint.
 */

export const R2_BUCKET = process.env.R2_BUCKET ?? "yachtpics-media";

/** Public base for served files, e.g. https://media.yachtpics.com (no trailing slash). */
export function r2PublicBase(): string {
  return (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
}

/** Is R2 wired up? Everything that touches it should check this first. */
export function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_BASE_URL
  );
}

/** Which settings are missing — so a failure names the gap instead of just erroring. */
export function r2MissingConfig(): string[] {
  return [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_BASE_URL",
  ].filter((k) => !process.env[k]);
}

let client: S3Client | null = null;

export function r2(): S3Client {
  if (client) return client;
  client = new S3Client({
    // R2 ignores the region but the S3 client insists on one.
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}

/** The public URL a stored object is served from. */
export function r2PublicUrl(key: string): string {
  return `${r2PublicBase()}/${key.replace(/^\/+/, "")}`;
}

export async function r2Put(key: string, body: Uint8Array | Buffer, contentType: string): Promise<void> {
  await r2().send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

export async function r2Delete(key: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

/** Does this object already exist? Used to skip re-uploading unchanged files. */
export async function r2Exists(key: string): Promise<boolean> {
  try {
    await r2().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}
