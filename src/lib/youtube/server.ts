/**
 * YouTube upload — database side (Nov 27, 2026). Server only, service role.
 *
 * Tables (supabase/migrations/20261127_youtube_upload.sql, RLS on, no
 * policies — only the service role reads or writes them):
 *   youtube_channels  one row per connected channel, tokens AES-256-GCM sealed
 *   youtube_uploads   one row per upload, with progress
 * They are read only in their own queries; a missing table or column means
 * "not set up" (never an error on a page).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requestOrigin } from "@/lib/meta/oauth";
import { YOUTUBE_CALLBACK_PATH, youtubeConfigured } from "./config";
import { openYouTubeToken, sealYouTubeToken } from "./crypto";
import { refreshAccessToken } from "./google";
import { youtubeDescription, youtubeTitle } from "./metadata";

export function youtubeServiceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** A missing table (42P01 / PGRST205) or column (42703 / PGRST204): the migration isn't applied. */
export function isMissingYouTubeSchema(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205" || err.code === "42703" || err.code === "PGRST204") return true;
  return /youtube_(channels|uploads)/.test(err.message ?? "") && /does not exist|could not find/i.test(err.message ?? "");
}

/**
 * Canonical origin for the OAuth redirect URI. Same rule as the jobs worker's
 * base URL (src/lib/jobs/queue.ts jobsBaseUrl): NEXT_PUBLIC_SITE_URL when set,
 * else the request's public origin (Meta's requestOrigin). Google requires the
 * redirect URI to match the one registered exactly, so Connect has to be
 * started from https://portal.yachtpics.com (or NEXT_PUBLIC_SITE_URL).
 */
export function youtubeSiteOrigin(req: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env && /^https?:\/\//.test(env)) return env.replace(/\/+$/, "");
  return requestOrigin(req).replace(/\/+$/, "");
}

export function youtubeRedirectUri(req: Request): string {
  return `${youtubeSiteOrigin(req)}${YOUTUBE_CALLBACK_PATH}`;
}

export type Readiness =
  | { configured: false; ready: false; reason: "env" }
  | { configured: true; ready: false; reason: "migration" | "error"; error?: string }
  | { configured: true; ready: true };

/** Env vars present AND both tables reachable. */
export async function youtubeReadiness(svc: SupabaseClient): Promise<Readiness> {
  if (!youtubeConfigured()) return { configured: false, ready: false, reason: "env" };
  const [a, b] = await Promise.all([
    svc.from("youtube_channels").select("id").limit(1),
    svc.from("youtube_uploads").select("id").limit(1),
  ]);
  const err = a.error ?? b.error;
  if (err) {
    if (isMissingYouTubeSchema(err)) return { configured: true, ready: false, reason: "migration" };
    return { configured: true, ready: false, reason: "error", error: err.message };
  }
  return { configured: true, ready: true };
}

export type ChannelRow = {
  id: string;
  channel_id: string;
  title: string | null;
  handle: string | null;
  thumbnail_url: string | null;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_token_expires_at: string | null;
  needs_reconnect: boolean;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
};

/** What the browser may see of a channel (never a token). */
export type PublicChannel = {
  id: string;
  channelId: string;
  title: string | null;
  handle: string | null;
  thumbnailUrl: string | null;
  needsReconnect: boolean;
  connectedAt: string;
  connectedBy: string | null;
};

export const PUBLIC_CHANNEL_COLUMNS = "id, channel_id, title, handle, thumbnail_url, needs_reconnect, connected_by, created_at";

export function toPublicChannel(r: Pick<ChannelRow, "id" | "channel_id" | "title" | "handle" | "thumbnail_url" | "needs_reconnect" | "connected_by" | "created_at">): PublicChannel {
  return {
    id: r.id,
    channelId: r.channel_id,
    title: r.title,
    handle: r.handle,
    thumbnailUrl: r.thumbnail_url,
    needsReconnect: !!r.needs_reconnect,
    connectedAt: r.created_at,
    connectedBy: r.connected_by,
  };
}

export async function listChannels(svc: SupabaseClient): Promise<{ channels: PublicChannel[]; error?: string; missing?: boolean }> {
  const { data, error } = await svc.from("youtube_channels").select(PUBLIC_CHANNEL_COLUMNS).order("created_at", { ascending: true });
  if (error) return { channels: [], error: error.message, missing: isMissingYouTubeSchema(error) };
  return { channels: ((data ?? []) as unknown as ChannelRow[]).map(toPublicChannel) };
}

export const RECONNECT_MESSAGE = "YouTube needs this channel connected again. Go to Admin → YouTube and connect it.";

export type AccessTokenResult = { token: string; error?: undefined; reconnect?: undefined } | { token?: undefined; error: string; reconnect: boolean };

/**
 * A usable access token for a connected channel. Uses the cached one unless
 * it expires within two minutes (or `force`), else refreshes it with the
 * refresh token and caches the new one. invalid_grant (permission removed,
 * or a Testing-mode token past its 7 days) marks the channel as needing
 * reconnect.
 */
export async function channelAccessToken(svc: SupabaseClient, channelRowId: string, opts: { force?: boolean } = {}): Promise<AccessTokenResult> {
  const { data, error } = await svc.from("youtube_channels").select("*").eq("id", channelRowId).maybeSingle();
  if (error) return { error: error.message, reconnect: false };
  if (!data) return { error: "That YouTube channel isn't connected any more.", reconnect: true };
  const row = data as ChannelRow;
  if (row.needs_reconnect) return { error: RECONNECT_MESSAGE, reconnect: true };

  if (!opts.force && row.access_token_enc && row.access_token_expires_at) {
    const exp = Date.parse(row.access_token_expires_at);
    if (Number.isFinite(exp) && exp - Date.now() > 120_000) {
      const cached = openYouTubeToken(row.access_token_enc);
      if (cached) return { token: cached };
    }
  }

  const refresh = openYouTubeToken(row.refresh_token_enc);
  if (!refresh) {
    await markNeedsReconnect(svc, row.id);
    return { error: RECONNECT_MESSAGE, reconnect: true };
  }
  const r = await refreshAccessToken(refresh);
  if (r.status === 200 && r.json?.access_token) {
    const expiresAt = new Date(Date.now() + Math.max(60, Number(r.json.expires_in) || 3600) * 1000).toISOString();
    await svc
      .from("youtube_channels")
      .update({ access_token_enc: sealYouTubeToken(r.json.access_token), access_token_expires_at: expiresAt, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    return { token: r.json.access_token };
  }
  if (r.json?.error === "invalid_grant" || r.json?.error === "unauthorized_client") {
    await markNeedsReconnect(svc, row.id);
    return { error: RECONNECT_MESSAGE, reconnect: true };
  }
  return { error: r.status === 0 ? `Couldn't reach Google (${r.error ?? "no answer"}).` : `Google didn't renew the permission (${r.status}).`, reconnect: false };
}

export async function markNeedsReconnect(svc: SupabaseClient, channelRowId: string): Promise<void> {
  await svc
    .from("youtube_channels")
    .update({ needs_reconnect: true, access_token_enc: null, access_token_expires_at: null, updated_at: new Date().toISOString() })
    .eq("id", channelRowId);
}

// ─── uploads ────────────────────────────────────────────────────────────────

export type UploadRow = {
  id: string;
  listing_id: string | null;
  video_id: string | null;
  channel_id: string | null;
  job_id: string | null;
  title: string;
  description: string;
  privacy: string;
  set_listing_link: boolean;
  replace_listing_link: boolean;
  status: string;
  bytes_sent: number;
  bytes_total: number | null;
  content_type: string | null;
  upload_session_url: string | null;
  session_restarts: number;
  consecutive_failures: number;
  youtube_video_id: string | null;
  youtube_url: string | null;
  listing_link_written: boolean;
  error: string | null;
  started_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  uploaded_at: string | null;
  finished_at: string | null;
};

/** What the browser sees of an upload (never the session URL). */
export type PublicUpload = {
  id: string;
  videoId: string | null;
  channelId: string | null;
  title: string;
  privacy: string;
  status: string;
  bytesSent: number;
  bytesTotal: number | null;
  youtubeUrl: string | null;
  listingLinkWritten: boolean;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export const PUBLIC_UPLOAD_COLUMNS =
  "id, video_id, channel_id, job_id, title, privacy, status, bytes_sent, bytes_total, youtube_url, listing_link_written, error, created_at, finished_at";

export function toPublicUpload(r: Pick<UploadRow, "id" | "video_id" | "channel_id" | "title" | "privacy" | "status" | "bytes_sent" | "bytes_total" | "youtube_url" | "listing_link_written" | "error" | "created_at" | "finished_at">): PublicUpload {
  return {
    id: r.id,
    videoId: r.video_id,
    channelId: r.channel_id,
    title: r.title,
    privacy: r.privacy,
    status: r.status,
    bytesSent: Number(r.bytes_sent) || 0,
    bytesTotal: r.bytes_total === null ? null : Number(r.bytes_total),
    youtubeUrl: r.youtube_url,
    listingLinkWritten: !!r.listing_link_written,
    error: r.error,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

/**
 * Uploads for one listing, newest first. An upload still "in flight" whose
 * job is no longer queued/running (cancelled or failed from Admin → Jobs, or
 * the runner gave up) is marked failed here, so the page never shows a
 * progress bar nobody is moving.
 */
export async function listingUploads(svc: SupabaseClient, listingId: string): Promise<{ uploads: PublicUpload[]; error?: string; missing?: boolean }> {
  const { data, error } = await svc
    .from("youtube_uploads")
    .select(PUBLIC_UPLOAD_COLUMNS)
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { uploads: [], error: error.message, missing: isMissingYouTubeSchema(error) };
  const rows = (data ?? []) as unknown as (UploadRow & { job_id: string | null })[];

  const inFlight = rows.filter((r) => ["queued", "uploading", "processing"].indexOf(r.status) >= 0 && r.job_id);
  if (inFlight.length) {
    const ids = Array.from(new Set(inFlight.map((r) => r.job_id as string)));
    const { data: jobs, error: jErr } = await svc.from("jobs").select("id, status, error").in("id", ids);
    if (!jErr) {
      const byId: Record<string, { status: string; error: string | null }> = {};
      ((jobs ?? []) as { id: string; status: string; error: string | null }[]).forEach((j) => (byId[j.id] = j));
      const now = new Date().toISOString();
      for (let i = 0; i < inFlight.length; i++) {
        const r = inFlight[i];
        const j = byId[r.job_id as string];
        if (j && (j.status === "queued" || j.status === "running")) continue;
        const msg = j?.status === "cancelled" ? "The upload was stopped." : "The upload stopped before it finished. Start it again.";
        const { data: upd } = await svc
          .from("youtube_uploads")
          .update({ status: j?.status === "cancelled" ? "cancelled" : "failed", error: msg, finished_at: now, updated_at: now })
          .eq("id", r.id)
          .in("status", ["queued", "uploading", "processing"])
          .select("id")
          .maybeSingle();
        if (upd) {
          r.status = j?.status === "cancelled" ? "cancelled" : "failed";
          r.error = msg;
          r.finished_at = now;
        }
      }
    }
  }
  return { uploads: rows.map(toPublicUpload) };
}

/** The prefilled title / description for a listing, plus its current YouTube link. */
export async function listingPrefill(
  svc: SupabaseClient,
  listingId: string
): Promise<{ title: string; description: string; youtubeUrl: string | null } | null> {
  const { data: l } = await svc
    .from("listings")
    .select("id, broker_id, vessel_name, year, make, model, length_ft, youtube_url")
    .eq("id", listingId)
    .maybeSingle();
  if (!l) return null;
  const listing = l as { broker_id: string | null; vessel_name: string | null; year: number | null; make: string | null; model: string | null; length_ft: number | null; youtube_url: string | null };
  let broker: { first_name: string | null; last_name: string | null; brokerage_name: string | null } | null = null;
  if (listing.broker_id) {
    const [{ data: p }, { data: d }] = await Promise.all([
      svc.from("profiles").select("first_name, last_name").eq("id", listing.broker_id).maybeSingle(),
      svc.from("broker_details").select("brokerage_name").eq("id", listing.broker_id).maybeSingle(),
    ]);
    broker = {
      first_name: (p?.first_name as string | null) ?? null,
      last_name: (p?.last_name as string | null) ?? null,
      brokerage_name: (d?.brokerage_name as string | null) ?? null,
    };
  }
  return {
    title: youtubeTitle(listing),
    description: youtubeDescription(listing, broker),
    youtubeUrl: (listing.youtube_url ?? "").trim() || null,
  };
}
