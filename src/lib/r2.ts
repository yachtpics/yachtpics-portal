import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

// ── Private video bucket ────────────────────────────────────────────────────
//
// A second bucket, deliberately NOT public. R2 makes a whole bucket public or
// not — there is no per-file setting — so client video cannot share the bucket
// the website serves from. Everything here is reached through short-lived
// signed links, the same shape of protection Supabase gave us.

export const R2_VIDEO_BUCKET = process.env.R2_VIDEO_BUCKET ?? "yachtpics-video";

export function r2VideoConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_VIDEO_BUCKET
  );
}

/**
 * A temporary URL to read one private object.
 *
 * Six hours by default — long enough that a broker can start a large download
 * and not have it die halfway, short enough that a link copied out of the page
 * and forwarded on stops working. Matches the window the Supabase signed URLs
 * already used, so nothing about the experience changes.
 */
export async function r2SignedGetUrl(
  key: string,
  opts: { expiresIn?: number; downloadAs?: string } = {}
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: R2_VIDEO_BUCKET,
    Key: key,
    // Makes the browser save the file under its original name rather than the
    // storage key, which is a timestamped path nobody wants on their desktop.
    ...(opts.downloadAs ? { ResponseContentDisposition: contentDisposition(opts.downloadAs) } : {}),
  });
  // Seven days is SigV4's hard ceiling; anything longer makes signing throw,
  // and several callers swallow errors — the video would just silently vanish.
  return getSignedUrl(r2(), cmd, { expiresIn: Math.min(opts.expiresIn ?? 60 * 60 * 6, 604800) });
}

/**
 * A temporary URL the browser can upload one file to.
 *
 * Uploads go straight from the broker's machine to Cloudflare. They must not
 * pass through our server: these are hundreds of megabytes, and a serverless
 * function has both a time limit and a request size limit that a 1.4GB drone
 * clip would sail past.
 */
export async function r2SignedPutUrl(
  key: string,
  contentType: string,
  expiresIn = 60 * 60 * 2
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: R2_VIDEO_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2(), cmd, { expiresIn });
}

export async function r2VideoPut(key: string, body: Uint8Array | Buffer, contentType: string): Promise<void> {
  await r2().send(new PutObjectCommand({
    Bucket: R2_VIDEO_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

export async function r2VideoDelete(key: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: R2_VIDEO_BUCKET, Key: key }));
}

/** Size in bytes, or null if it isn't there. Used to verify a migrated copy. */
export async function r2VideoSize(key: string): Promise<number | null> {
  try {
    const res = await r2().send(new HeadObjectCommand({ Bucket: R2_VIDEO_BUCKET, Key: key }));
    return res.ContentLength ?? null;
  } catch {
    return null;
  }
}


/**
 * Allow the portal's own pages to talk to the video bucket from the browser.
 *
 * Browsers block cross-origin PUTs and fetches unless the bucket explicitly
 * permits them, and an R2 bucket permits nothing by default — so without this,
 * every direct upload and every zip download of an r2-hosted video fails with
 * an opaque network error. Applied idempotently by the self-test, so a fresh
 * environment fixes itself the first time the test is run.
 *
 * GET is included because gallery zip downloads fetch video bytes with
 * JavaScript; plain <video> playback never needed CORS.
 */
export async function r2EnsureVideoCors(): Promise<void> {
  await r2().send(new PutBucketCorsCommand({
    Bucket: R2_VIDEO_BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [
            "https://portal.yachtpics.com",
            "http://localhost:3000",
          ],
          AllowedMethods: ["GET", "PUT", "HEAD"],
          AllowedHeaders: ["content-type"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }));
}

/**
 * A Content-Disposition value that survives accented and non-Latin filenames.
 *
 * S3-compatible stores reject non-ASCII in response-content-disposition at
 * request time — the signing succeeds and the link 400s only when clicked,
 * which is the worst place to find out. RFC 5987 encoding (an ASCII fallback
 * plus a percent-encoded filename*) is what every browser actually reads.
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/["\\]/g, "").replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
