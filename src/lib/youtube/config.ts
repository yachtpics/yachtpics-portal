/**
 * YouTube upload — the one place for its switches (Nov 27, 2026). Admin only.
 *
 * Everything here works with the env vars missing: the feature then reports
 * "not set up" and the UI shows one quiet line. Nothing throws at import.
 * Safe to import from client components (no server-only imports, no secrets
 * read here except by name).
 *
 * Setup steps for Charlie: docs/youtube-setup.md.
 */

export const GOOGLE_CLIENT_ID_ENV = "GOOGLE_OAUTH_CLIENT_ID";
export const GOOGLE_CLIENT_SECRET_ENV = "GOOGLE_OAUTH_CLIENT_SECRET";

/** Permissions asked for at Connect: upload, and read the channel / processing state. */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";

/** Path of the OAuth callback; the full redirect URI is `${origin}${this}`. */
export const YOUTUBE_CALLBACK_PATH = "/api/admin/youtube/callback";

/**
 * Until Google's YouTube API audit passes, YouTube locks every upload made
 * through the API to Private. While this is false the upload dialog says so in
 * one line. Flip to true once the audit is approved (docs/youtube-setup.md,
 * "Getting uploads to go public").
 */
export const YOUTUBE_APP_AUDITED = false;
export const YOUTUBE_PRIVATE_UNTIL_AUDIT_NOTE =
  "Until Google approves the Portal's app, YouTube keeps uploads private. You can still open them in YouTube Studio.";

/** 256 KiB — YouTube's resumable chunks must be a multiple of this (except the last). */
export const RESUMABLE_GRANULE = 256 * 1024;
/** Bytes sent per PUT: 16 MiB (64 × 256 KiB). One chunk is held in memory at a time. */
export const YOUTUBE_CHUNK_BYTES = 64 * RESUMABLE_GRANULE;

/**
 * Wall-clock budget for one job batch of an upload. The worker routes
 * (/api/jobs/work, /api/jobs/tick) have maxDuration 60 s and the runner gives
 * a handler 40 s (STEP_BUDGET_MS); 32 s leaves room for one slow chunk to
 * finish plus saving progress. A chunk is only started when the slowest chunk
 * so far would still fit.
 */
export const YOUTUBE_TICK_BUDGET_MS = 32_000;
/** One PUT / GET never runs longer than this. */
export const YOUTUBE_REQUEST_TIMEOUT_MS = 25_000;
/** Consecutive batches that hit a server / network error before giving up. */
export const YOUTUBE_MAX_CONSECUTIVE_FAILURES = 6;
/** How long to keep checking "YouTube is processing it" before calling it done. */
export const YOUTUBE_PROCESSING_MAX_MS = 20 * 60_000;
/** Pause between processing checks inside one batch. */
export const YOUTUBE_PROCESSING_POLL_MS = 15_000;

export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_DESCRIPTION_MAX = 5000;
/** Autos & Vehicles. */
export const YOUTUBE_CATEGORY_ID = "2";

export const YOUTUBE_PRIVACY = ["public", "unlisted", "private"] as const;
export type YouTubePrivacy = (typeof YOUTUBE_PRIVACY)[number];
export function isYouTubePrivacy(x: unknown): x is YouTubePrivacy {
  return typeof x === "string" && (YOUTUBE_PRIVACY as readonly string[]).indexOf(x) >= 0;
}

export type YouTubeUploadStatus = "queued" | "uploading" | "processing" | "done" | "failed" | "cancelled";
export const YOUTUBE_ACTIVE_STATUSES: YouTubeUploadStatus[] = ["queued", "uploading", "processing"];
export function isActiveUpload(s: string): boolean {
  return (YOUTUBE_ACTIVE_STATUSES as string[]).indexOf(s) >= 0;
}

export const YOUTUBE_MIGRATION_FILE = "supabase/migrations/20261127_youtube_upload.sql";
export const YOUTUBE_NOT_SET_UP = "YouTube isn't set up yet.";

/** Server only in practice (reads process.env): both Google keys are present. */
export function youtubeConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

export function googleClientId(): string | null {
  return process.env.GOOGLE_OAUTH_CLIENT_ID || null;
}

export function googleClientSecret(): string | null {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET || null;
}
