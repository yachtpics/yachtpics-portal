/**
 * Job `video_codec_scan` — read the format of every stored listing video
 * (Nov 20, 2026).
 *
 * For each video with codec_checked_at null (id order, small pages, the 40 s
 * step budget), range-read the first 1 MB of the ORIGINAL from wherever it
 * lives (storage_host 'r2' → the private video bucket, anything else →
 * Supabase `listing-videos`), hop to moov when it's at the end (one more small
 * range read, capped at 8 MB), parse it (src/lib/videoCodec.ts) and write
 * video_codec / video_width / video_height / codec_checked_at.
 *
 * Reads only — never modifies or deletes a video file. A file whose format
 * can't be determined is stored as 'unknown' so it isn't retried forever; a
 * file that couldn't be READ (signing failed, storage error, timeout) is left
 * unchecked and logged, so a later run tries it again. One video's failure
 * never stops the job.
 *
 * params: { recheckUnknown?: boolean, limit?: number }
 *   recheckUnknown  also re-read videos already marked 'unknown'
 *   limit           stop after this many videos (trial run)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { signVideoUrl } from "@/lib/videoUrls";
import { codecLabel, isRiskyCodec, probeVideoCodec, type VideoCodecInfo } from "@/lib/videoCodec";
import { JobFatalError, type JobHandler } from "./types";

const PAGE = 20;
/** First guess at one video's time (two signed range reads). */
const FIRST_GUESS_MS = 4_000;
/** One range read gives up after this. */
const READ_TIMEOUT_MS = 15_000;

export const VIDEO_CODEC_SCAN_MAX_LIMIT = 5000;

export const VIDEO_CODEC_COLUMNS_MISSING =
  "The video format columns aren't in the database yet — apply supabase/migrations/20261120_video_codec.sql in the Supabase SQL Editor, then run this again.";

/** Postgres 42703 / PostgREST "column … does not exist / could not find". */
export function isMissingCodecColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  return /video_codec|video_width|video_height|codec_checked_at/.test(err.message ?? "") && /does not exist|could not find/i.test(err.message ?? "");
}

type Cursor = { lastId?: string; checked?: number; h265?: number; prores?: number; unknown?: number; failed?: number };

type VideoRow = {
  id: string;
  listing_id: string | null;
  storage_path: string;
  storage_host: string | null;
  filename: string | null;
};

function pending(svc: SupabaseClient, recheckUnknown: boolean, head = false) {
  const q = svc
    .from("videos")
    .select("id, listing_id, storage_path, storage_host, filename", head ? { count: "exact", head: true } : undefined);
  return recheckUnknown ? q.or("codec_checked_at.is.null,video_codec.eq.unknown") : q.is("codec_checked_at", null);
}

/** "bytes 0-1048575/52428800" → 52428800 */
function totalFromContentRange(h: string | null): number | null {
  const m = /\/(\d+)\s*$/.exec(h ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Range-read [start, end) of a signed URL. Refuses a 200 (whole-file) answer
 * rather than downloading a multi-GB video.
 */
async function rangeRead(url: string, start: number, end: number): Promise<{ bytes: Uint8Array; total: number | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), READ_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=${start}-${Math.max(start, end - 1)}` },
      cache: "no-store",
      signal: ctl.signal,
    });
    if (res.status !== 206) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      throw new Error(res.status === 200 ? "storage ignored the range request" : `storage answered ${res.status}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, total: totalFromContentRange(res.headers.get("content-range")) };
  } finally {
    clearTimeout(timer);
  }
}

/** Read one stored video's codec. Throws when the file can't be READ. */
async function probeStored(svc: SupabaseClient, v: VideoRow): Promise<VideoCodecInfo | null> {
  const url = await signVideoUrl(svc, v, { expiresIn: 600 });
  if (!url) throw new Error(v.storage_host === "r2" ? "couldn't sign the R2 link (is R2 configured?)" : "couldn't sign the Supabase link (file missing?)");
  // First request learns the size from Content-Range; tiny files are fine too.
  const first = await rangeRead(url, 0, 1024 * 1024);
  const size = first.total ?? first.bytes.length;
  return probeVideoCodec(
    async (s, e) => (s === 0 && e <= first.bytes.length ? first.bytes.slice(0, e) : (await rangeRead(url, s, e)).bytes),
    size
  );
}

function dims(info: VideoCodecInfo | null): string {
  return info && info.width && info.height ? ` (${info.width}×${info.height})` : "";
}

export const videoCodecScan: JobHandler = async (job, { svc, deadlineMs }) => {
  const p = (job.params ?? {}) as { recheckUnknown?: boolean; limit?: number };
  const recheckUnknown = p.recheckUnknown === true;
  const limit = typeof p.limit === "number" && p.limit > 0 ? p.limit : null;
  const cur = (job.cursor ?? {}) as Cursor;
  const c: Required<Cursor> = {
    lastId: cur.lastId ?? "",
    checked: cur.checked ?? 0,
    h265: cur.h265 ?? 0,
    prores: cur.prores ?? 0,
    unknown: cur.unknown ?? 0,
    failed: cur.failed ?? 0,
  };

  let total: number | undefined;
  if (job.total == null) {
    const { count, error } = await pending(svc, recheckUnknown, true);
    if (error) {
      if (isMissingCodecColumn(error)) throw new JobFatalError(VIDEO_CODEC_COLUMNS_MISSING);
      throw new Error(error.message);
    }
    total = limit !== null ? Math.min(limit, count ?? 0) : count ?? 0;
  }

  let q = pending(svc, recheckUnknown).order("id", { ascending: true }).limit(PAGE);
  if (c.lastId) q = q.gt("id", c.lastId);
  const { data, error } = await q;
  if (error) {
    if (isMissingCodecColumn(error)) throw new JobFatalError(VIDEO_CODEC_COLUMNS_MISSING);
    throw new Error(error.message);
  }
  const videos = (data ?? []) as unknown as VideoRow[];

  // Vessel names for the log, one query per page.
  const names: Record<string, string> = {};
  const listingIds = Array.from(new Set(videos.map((v) => v.listing_id).filter((x): x is string => !!x)));
  if (listingIds.length) {
    const { data: ls } = await svc.from("listings").select("id, vessel_name").in("id", listingIds);
    ((ls ?? []) as { id: string; vessel_name: string | null }[]).forEach((l) => (names[l.id] = l.vessel_name || "Untitled"));
  }

  let done = 0;
  let failed = 0;
  const log: string[] = [];
  let slowest = FIRST_GUESS_MS;
  let processed = 0;
  let hitLimit = false;

  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    if (limit !== null && c.checked + c.failed >= limit) {
      hitLimit = true;
      break;
    }
    // Always do at least one; after that only start one we expect to finish.
    if (processed > 0 && Date.now() + slowest * 1.5 > deadlineMs) break;
    const t0 = Date.now();
    const label = `${(v.listing_id && names[v.listing_id]) || "No listing"} — ${v.filename || v.storage_path.split("/").pop() || "video"}`;

    try {
      const info = await probeStored(svc, v);
      const codec = info ? info.codec : "unknown";
      const { error: wErr } = await svc
        .from("videos")
        .update({
          video_codec: codec,
          video_width: info?.width ?? null,
          video_height: info?.height ?? null,
          codec_checked_at: new Date().toISOString(),
        })
        .eq("id", v.id);
      if (wErr) {
        if (isMissingCodecColumn(wErr)) throw new JobFatalError(VIDEO_CODEC_COLUMNS_MISSING);
        throw new Error(wErr.message);
      }
      c.checked++;
      done++;
      if (codec === "h265") c.h265++;
      else if (codec === "prores") c.prores++;
      else if (codec === "unknown") c.unknown++;
      if (isRiskyCodec(codec)) log.push(`${label} — ${codec === "h265" ? "H.265" : codecLabel(codec)}${dims(info)}`);
      else if (codec === "unknown") log.push(`${label} — format not found in the file (marked unknown)`);
    } catch (e) {
      if (e instanceof JobFatalError) throw e;
      c.failed++;
      failed++;
      const msg = e instanceof Error ? (e.name === "AbortError" ? "timed out" : e.message) : String(e);
      log.push(`${label} — couldn't read: ${msg}`);
    }

    c.lastId = v.id;
    processed++;
    slowest = Math.max(slowest, Date.now() - t0);
  }

  const finished = hitLimit || (videos.length < PAGE && processed === videos.length);
  if (finished) {
    log.push(
      `Finished — ${c.checked} checked: ${c.h265} H.265, ${c.prores} ProRes, ${c.unknown} unknown` +
        (c.failed ? `; ${c.failed} couldn't be read (left unchecked — run again to retry)` : "") +
        (hitLimit ? ` (stopped at the limit of ${limit}).` : ".")
    );
  }
  return { cursor: c, done, failed, total, log, finished };
};
