import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { r2 } from "./r2";

/**
 * Copy a large file into R2 in pieces, across separate requests.
 *
 * The first version of this downloaded the whole video into memory and then
 * uploaded it. That works on a 20MB clip and dies on a real one: the first boat
 * we tried had a 1.2GB drone file, which is more memory than a serverless
 * function has and more time than it's allowed. The request crashed and the
 * browser got an HTML error page instead of an answer.
 *
 * So: S3 multipart upload, one part per HTTP request. Each request pulls a byte
 * range from the source and pushes it to R2 — a fixed, small amount of memory
 * and a few seconds, no matter whether the file is 20MB or 2GB. The upload id
 * and the part list travel back and forth with the browser, so the work is
 * resumable and a dropped connection costs one part rather than the whole file.
 *
 * The same machinery serves the eventual move of all 97 videos off Supabase.
 */

/** 64MB parts. S3 requires at least 5MB except for the last one; this is a
 *  comfortable size to pull and push inside one request. */
export const PART_SIZE = 64 * 1024 * 1024;

export type PartRef = { PartNumber: number; ETag: string };

export async function startCopy(bucket: string, key: string, contentType: string): Promise<string> {
  const res = await r2().send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  }));
  if (!res.UploadId) throw new Error("R2 didn't return an upload id.");
  return res.UploadId;
}

/**
 * Pull one byte range from `sourceUrl` and upload it as part `partNumber`.
 *
 * The source must honour HTTP Range requests — Supabase storage does, which is
 * what makes this possible without the file ever being held whole anywhere.
 */
export async function copyPart(args: {
  bucket: string;
  key: string;
  uploadId: string;
  sourceUrl: string;
  partNumber: number;
  start: number;
  end: number;
}): Promise<PartRef> {
  const res = await fetch(args.sourceUrl, {
    headers: { Range: `bytes=${args.start}-${args.end}` },
    cache: "no-store",
  });

  // 206 is the expected answer. A 200 means the source ignored the range and is
  // about to hand back the entire file — which is exactly what this avoids.
  if (res.status !== 206) {
    throw new Error(
      res.status === 200
        ? "The source returned the whole file instead of the requested part."
        : `Couldn't read that part of the file (${res.status}).`
    );
  }

  const body = Buffer.from(await res.arrayBuffer());

  const up = await r2().send(new UploadPartCommand({
    Bucket: args.bucket,
    Key: args.key,
    UploadId: args.uploadId,
    PartNumber: args.partNumber,
    Body: body,
  }));

  if (!up.ETag) throw new Error("R2 didn't acknowledge that part.");
  return { PartNumber: args.partNumber, ETag: up.ETag };
}

export async function finishCopy(
  bucket: string,
  key: string,
  uploadId: string,
  parts: PartRef[]
): Promise<void> {
  await r2().send(new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    UploadId: uploadId,
    // S3 is strict about order, and the browser may have sent parts back in
    // whatever order they finished.
    MultipartUpload: { Parts: [...parts].sort((a, b) => a.PartNumber - b.PartNumber) },
  }));
}

/**
 * Abandon a half-finished upload.
 *
 * Worth doing: incomplete multipart uploads keep their uploaded parts in the
 * bucket and are billed for, while being invisible in the file listing. A
 * cancelled 1.2GB copy that nobody cleaned up is a bill for storage you can't
 * see.
 */
export async function abortCopy(bucket: string, key: string, uploadId: string): Promise<void> {
  await r2().send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
}

/** How many parts a file of this size needs. */
export function partCount(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / PART_SIZE));
}

/** Byte range for a given part (1-based, as S3 numbers them). */
export function partRange(partNumber: number, totalBytes: number): { start: number; end: number } {
  const start = (partNumber - 1) * PART_SIZE;
  return { start, end: Math.min(start + PART_SIZE, totalBytes) - 1 };
}
