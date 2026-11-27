/**
 * Pure pieces of YouTube's resumable upload protocol (Nov 27, 2026):
 * chunk planning, reading the session's "Range" answer, and sorting Google's
 * error answers into what the job should do. No I/O — checked by
 * scripts/youtube_upload_check.ts.
 */
import { RESUMABLE_GRANULE } from "./config";

export type Chunk = {
  /** First byte (inclusive). */
  start: number;
  /** Last byte (inclusive). */
  end: number;
  /** Bytes in this chunk. */
  size: number;
  /** This chunk ends the file. */
  last: boolean;
};

/**
 * The next chunk to send, starting at `offset` (bytes YouTube has confirmed),
 * or null when the whole file is confirmed. `chunkBytes` must be a positive
 * multiple of 256 KiB; every chunk but the last is exactly that size.
 */
export function nextChunk(offset: number, total: number, chunkBytes: number): Chunk | null {
  if (!(chunkBytes > 0) || chunkBytes % RESUMABLE_GRANULE !== 0) {
    throw new Error("Chunk size must be a multiple of 256 KiB.");
  }
  if (!(total > 0) || offset >= total) return null;
  const start = Math.max(0, Math.floor(offset));
  const end = Math.min(total, start + chunkBytes) - 1;
  return { start, end, size: end - start + 1, last: end === total - 1 };
}

/** Every chunk of a file from `offset`, in order (used by the offline check). */
export function planChunks(total: number, chunkBytes: number, offset = 0): Chunk[] {
  const out: Chunk[] = [];
  let at = offset;
  for (let c = nextChunk(at, total, chunkBytes); c; c = nextChunk(at, total, chunkBytes)) {
    out.push(c);
    at = c.end + 1;
  }
  return out;
}

/**
 * The byte to resume from, given a 308 answer's Range header
 * ("bytes=0-1048575" → 1048576). No header = nothing received yet = 0.
 * An unreadable header also gives 0 (YouTube then gets the whole file again
 * from the start, which it accepts).
 */
export function resumeOffsetFromRange(range: string | null | undefined): number {
  if (!range) return 0;
  const m = /bytes\s*=\s*(\d+)\s*-\s*(\d+)/i.exec(range);
  if (!m) return 0;
  const first = Number(m[1]);
  const last = Number(m[2]);
  if (first !== 0 || !Number.isFinite(last) || last < 0) return 0;
  return last + 1;
}

/** "Content-Range" for a chunk PUT. */
export function contentRange(c: Chunk, total: number): string {
  return `bytes ${c.start}-${c.end}/${total}`;
}

/** "Content-Range" for the "where are we?" PUT. */
export function statusQueryRange(total: number): string {
  return `bytes */${total}`;
}

/** "bytes 0-0/52428800" → 52428800 */
export function totalFromContentRange(h: string | null | undefined): number | null {
  const m = /\/(\d+)\s*$/.exec(h ?? "");
  return m ? Number(m[1]) : null;
}

/** Content type YouTube is told the file is, from the stored name / storage header. */
export function videoContentType(filename: string | null | undefined, header?: string | null): string {
  const h = (header ?? "").split(";")[0].trim().toLowerCase();
  if (h.indexOf("video/") === 0) return h;
  const ext = (filename ?? "").toLowerCase().split(".").pop() ?? "";
  if (ext === "mov") return "video/quicktime";
  if (ext === "m4v") return "video/x-m4v";
  if (ext === "webm") return "video/webm";
  return "video/mp4";
}

// ─── Google's error answers ─────────────────────────────────────────────────

export type GoogleErrorAction =
  /** Access token rejected: refresh once and try again. */
  | "refresh"
  /** The upload session expired or is gone: start a new one from byte 0. */
  | "restart"
  /** Try again later (server error, rate limit, network). */
  | "retry"
  /** Won't work by trying again: fail the upload with `message`. */
  | "fail";

export type GoogleErrorVerdict = { action: GoogleErrorAction; message: string; reason: string | null };

/** The first `error.errors[].reason` (or `error.status`) in a Google JSON error body. */
export function googleErrorReason(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const e = (body as { error?: unknown }).error;
  if (typeof e === "string") return e;
  if (!e || typeof e !== "object") return null;
  const errs = (e as { errors?: { reason?: string }[] }).errors;
  if (Array.isArray(errs) && errs.length && typeof errs[0]?.reason === "string") return errs[0].reason as string;
  const st = (e as { status?: string }).status;
  return typeof st === "string" ? st : null;
}

const PLAIN_403: Record<string, string> = {
  quotaExceeded: "YouTube's daily upload allowance for the Portal is used up. Try again tomorrow.",
  dailyLimitExceeded: "YouTube's daily upload allowance for the Portal is used up. Try again tomorrow.",
  uploadLimitExceeded: "This YouTube channel has reached its upload limit for now. Try again in a day.",
  youtubeSignupRequired: "This Google account doesn't have a YouTube channel yet. Create the channel in YouTube, then connect it again.",
  forbidden: "YouTube refused the upload for this channel.",
  insufficientPermissions: "The Portal wasn't given permission to upload. Disconnect the channel and connect it again.",
  accessNotConfigured: "The YouTube Data API isn't switched on in the Google Cloud project.",
};

/**
 * What to do with a non-success answer from YouTube / Google.
 * `status` 0 = the request never got an answer (network, timeout).
 * `duringSession` = the request went to the upload session URL.
 */
export function classifyGoogleError(status: number, body: unknown, duringSession: boolean): GoogleErrorVerdict {
  const reason = googleErrorReason(body);
  if (status === 0) return { action: "retry", message: "Couldn't reach YouTube.", reason };
  if (status === 401) return { action: "refresh", message: "YouTube asked the Portal to sign in again.", reason };
  if (status === 403) {
    if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
      return { action: "retry", message: "YouTube asked the Portal to slow down.", reason };
    }
    return { action: "fail", message: (reason && PLAIN_403[reason]) || PLAIN_403.forbidden, reason };
  }
  if ((status === 404 || status === 410) && duringSession) {
    return { action: "restart", message: "YouTube's upload session expired.", reason };
  }
  if (status === 429 || status >= 500) return { action: "retry", message: `YouTube had a problem (${status}).`, reason };
  if (status === 400) {
    const why =
      reason === "invalidTitle" ? "YouTube didn't accept the title."
      : reason === "invalidDescription" ? "YouTube didn't accept the description."
      : reason === "invalidCategoryId" ? "YouTube didn't accept the category."
      : "YouTube didn't accept the upload details.";
    return { action: "fail", message: why, reason };
  }
  return { action: "fail", message: `YouTube answered ${status}.`, reason };
}
