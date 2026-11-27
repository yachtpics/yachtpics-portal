/**
 * Job `youtube_upload` — send one listing video to YouTube (Nov 27, 2026).
 * Admin only; started by POST /api/admin/youtube/uploads.
 *
 * params: { uploadId } — the row in public.youtube_uploads. That row, not the
 * job cursor, is the source of truth (status, bytes_sent, the session URL,
 * the failure counters), so a batch that dies half way loses nothing: the
 * next batch asks YouTube where the session got to and carries on.
 *
 * One batch (YOUTUBE_TICK_BUDGET_MS, inside the runner's 40 s):
 *   1. no session yet → learn the file size with a 1-byte range read from
 *      storage, then open a resumable session (POST …/upload/youtube/v3/videos
 *      ?uploadType=resumable) and keep its Location URL;
 *   2. ask the session where it is (PUT, Content-Range: bytes * /TOTAL);
 *   3. copy 16 MiB chunks: ranged GET from storage → PUT to the session,
 *      one chunk in memory at a time, starting a chunk only when the slowest
 *      one so far would still fit; bytes_sent is saved after every chunk;
 *   4. 200/201 → the video id → status "processing"; later batches poll
 *      videos.list until YouTube says "processed" (or 20 minutes pass), then
 *      "done", and the listing's YouTube link is written if asked.
 * Errors: 401 → refresh the access token once and retry; 403 quota / upload
 * limit / no channel → fail with a plain sentence; 404/410 on the session →
 * one fresh session from byte 0; 5xx / 429 / network → a pause, then the next
 * batch; YOUTUBE_MAX_CONSECUTIVE_FAILURES in a row → fail. Never throws for
 * an expected problem, so the runner's own retry counter only sees real bugs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { signVideoUrl } from "@/lib/videoUrls";
import {
  YOUTUBE_CATEGORY_ID, YOUTUBE_CHUNK_BYTES, YOUTUBE_DESCRIPTION_MAX, YOUTUBE_MAX_CONSECUTIVE_FAILURES,
  YOUTUBE_PROCESSING_MAX_MS, YOUTUBE_PROCESSING_POLL_MS, YOUTUBE_REQUEST_TIMEOUT_MS, YOUTUBE_TICK_BUDGET_MS,
  YOUTUBE_TITLE_MAX, YOUTUBE_UPLOAD_URL,
} from "@/lib/youtube/config";
import { googleFetch, videoState } from "@/lib/youtube/google";
import {
  classifyGoogleError, contentRange, nextChunk, resumeOffsetFromRange, statusQueryRange, totalFromContentRange,
  videoContentType, type GoogleErrorVerdict,
} from "@/lib/youtube/resumable";
import { channelAccessToken, isMissingYouTubeSchema, type AccessTokenResult, type UploadRow } from "@/lib/youtube/server";
import { JobFatalError, type JobHandler, type StepResult } from "./types";

/** Hard stop for any single request: the worker invocation has 60 s in all. */
const HARD_STOP_MS = 52_000;
/** First guess at one chunk's time (GET from storage + PUT to YouTube). */
const FIRST_CHUNK_GUESS_MS = 8_000;
const ACTIVE = ["queued", "uploading", "processing"];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

type Step = {
  svc: SupabaseClient;
  row: UploadRow;
  started: number;
  deadline: number;
  log: string[];
  token: string | null;
  refreshed: boolean;
};

function result(finished: boolean, s: Step, outcome: "done" | "failed" | null = null): StepResult {
  return {
    cursor: { status: s.row.status, bytesSent: s.row.bytes_sent },
    done: outcome === "done" ? 1 : 0,
    failed: outcome === "failed" ? 1 : 0,
    total: 1,
    log: s.log,
    finished,
  };
}

/** Patch the upload row, only while it is still active (a cancel wins). Returns false if it wasn't. */
async function save(s: Step, patch: Partial<UploadRow>): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await s.svc
    .from("youtube_uploads")
    .update({ ...patch, updated_at: now })
    .eq("id", s.row.id)
    .in("status", ACTIVE)
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingYouTubeSchema(error)) throw new JobFatalError("The YouTube tables aren't in the database (migration 20261127_youtube_upload.sql).");
    throw new Error(error.message);
  }
  if (!data) return false;
  Object.assign(s.row, patch);
  return true;
}

async function fail(s: Step, message: string): Promise<StepResult> {
  const now = new Date().toISOString();
  await save(s, { status: "failed", error: message, finished_at: now, upload_session_url: null });
  s.log.push(`Failed: ${message}`);
  return result(true, s, "failed");
}

/** A problem that may clear: pause, count it, let the next batch try. */
async function transient(s: Step, message: string): Promise<StepResult> {
  const n = (s.row.consecutive_failures ?? 0) + 1;
  if (n >= YOUTUBE_MAX_CONSECUTIVE_FAILURES) {
    return fail(s, `${message} Gave up after ${n} tries in a row.`);
  }
  const ok = await save(s, { consecutive_failures: n, error: message });
  if (!ok) return stopped(s);
  s.log.push(`${message} Trying again shortly (${n} of ${YOUTUBE_MAX_CONSECUTIVE_FAILURES}).`);
  const pause = Math.min([5_000, 10_000, 20_000, 30_000][Math.min(n - 1, 3)], s.deadline - Date.now());
  await sleep(pause);
  return result(false, s);
}

function stopped(s: Step): StepResult {
  s.log.push("The upload was stopped.");
  return result(true, s);
}

function remaining(s: Step): number {
  return s.started + HARD_STOP_MS - Date.now();
}

function requestTimeout(s: Step): number {
  return Math.max(5_000, Math.min(YOUTUBE_REQUEST_TIMEOUT_MS, remaining(s)));
}

/** Get (or force-refresh) the access token. null + a StepResult when it can't. */
async function ensureToken(s: Step, force = false): Promise<StepResult | null> {
  if (s.token && !force) return null;
  const t = await channelAccessToken(s.svc, s.row.channel_id as string, { force });
  if (t.token) {
    s.token = t.token;
    return null;
  }
  const msg = t.error ?? "Couldn't get permission from Google.";
  return t.reconnect ? fail(s, msg) : transient(s, msg);
}

/** Act on a classified Google error. "refresh" is handled by the caller first. */
async function onGoogleError(s: Step, v: GoogleErrorVerdict, where: string): Promise<StepResult | "restart"> {
  if (v.action === "fail") return fail(s, v.message);
  if (v.action === "restart") return "restart";
  if (v.action === "refresh") return transient(s, "YouTube kept refusing the Portal's permission.");
  return transient(s, `${v.message} (${where})`);
}

// ─── storage ────────────────────────────────────────────────────────────────

type Source = { url: string; filename: string | null };

async function videoSource(s: Step): Promise<Source | StepResult> {
  if (!s.row.video_id) return fail(s, "The video was deleted from the Portal.");
  const { data: v, error } = await s.svc
    .from("videos")
    .select("id, storage_path, storage_host, filename")
    .eq("id", s.row.video_id)
    .maybeSingle();
  if (error) return transient(s, `Couldn't read the video record (${error.message}).`);
  if (!v) return fail(s, "The video was deleted from the Portal.");
  const url = await signVideoUrl(s.svc, v as { id: string; storage_path: string; storage_host: string | null; filename: string | null }, { expiresIn: 3600 });
  if (!url) return transient(s, "Couldn't open the video file in storage.");
  return { url, filename: (v.filename as string | null) ?? null };
}

/** [start, end] inclusive from storage. Refuses a whole-file answer. */
async function readRange(s: Step, url: string, start: number, end: number): Promise<{ bytes?: Uint8Array; total?: number | null; type?: string | null; error?: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), requestTimeout(s));
  try {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, cache: "no-store", signal: ctl.signal });
    if (res.status !== 206) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return { error: res.status === 200 ? "storage ignored the range request" : `storage answered ${res.status}` };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, total: totalFromContentRange(res.headers.get("content-range")), type: res.headers.get("content-type") };
  } catch (e) {
    return { error: e instanceof Error ? (e.name === "AbortError" ? "storage read timed out" : e.message) : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// ─── the resumable session ──────────────────────────────────────────────────

/** Open a session. Returns null on success (row updated), or the StepResult to return. */
async function openSession(s: Step): Promise<StepResult | null> {
  const total = Number(s.row.bytes_total);
  const metadata = {
    snippet: {
      title: (s.row.title || "Listing video").slice(0, YOUTUBE_TITLE_MAX),
      description: (s.row.description || "").slice(0, YOUTUBE_DESCRIPTION_MAX),
      categoryId: YOUTUBE_CATEGORY_ID,
    },
    status: { privacyStatus: s.row.privacy, selfDeclaredMadeForKids: false, embeddable: true },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await googleFetch(`${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(total),
        "X-Upload-Content-Type": s.row.content_type || "video/mp4",
      },
      body: JSON.stringify(metadata),
      timeoutMs: requestTimeout(s),
    });
    const location = r.headers?.get("location");
    if (r.status === 200 && location) {
      const ok = await save(s, { upload_session_url: location, bytes_sent: 0, consecutive_failures: 0, error: null });
      if (!ok) return stopped(s);
      s.log.push(`Started a YouTube upload session (${mb(total)}).`);
      return null;
    }
    const v = classifyGoogleError(r.status === 200 ? 502 : r.status, r.json, false);
    if (v.action === "refresh" && !s.refreshed) {
      s.refreshed = true;
      const bad = await ensureToken(s, true);
      if (bad) return bad;
      continue;
    }
    const out = await onGoogleError(s, v, "starting the upload");
    return out === "restart" ? transient(s, "YouTube didn't open an upload session.") : out;
  }
  return transient(s, "YouTube didn't open an upload session.");
}

/** Session gone: start again from byte 0, once. */
async function restartSession(s: Step): Promise<StepResult | null> {
  if ((s.row.session_restarts ?? 0) >= 1) return fail(s, "YouTube's upload session expired again. Start the upload again.");
  const ok = await save(s, { upload_session_url: null, bytes_sent: 0, session_restarts: (s.row.session_restarts ?? 0) + 1 });
  if (!ok) return stopped(s);
  s.log.push("YouTube's upload session expired — starting a new one from the beginning.");
  return openSession(s);
}

type SessionAnswer = { kind: "offset"; offset: number } | { kind: "finished"; json: unknown } | { kind: "stop"; result: StepResult };

/** Read a session answer (308 / 200 / 201 / error) into what to do next. */
async function readSessionAnswer(s: Step, r: { status: number; json: unknown; headers: Headers | null }, where: string): Promise<SessionAnswer | "retry-auth" | "restart"> {
  if (r.status === 308) return { kind: "offset", offset: resumeOffsetFromRange(r.headers?.get("range")) };
  if (r.status === 200 || r.status === 201) return { kind: "finished", json: r.json };
  const v = classifyGoogleError(r.status, r.json, true);
  if (v.action === "refresh" && !s.refreshed) return "retry-auth";
  const out = await onGoogleError(s, v, where);
  if (out === "restart") return "restart";
  return { kind: "stop", result: out };
}

async function querySession(s: Step): Promise<SessionAnswer> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await googleFetch(s.row.upload_session_url as string, {
      method: "PUT",
      headers: { Authorization: `Bearer ${s.token}`, "Content-Length": "0", "Content-Range": statusQueryRange(Number(s.row.bytes_total)) },
      timeoutMs: requestTimeout(s),
    });
    const a = await readSessionAnswer(s, r, "checking the upload");
    if (a === "retry-auth") {
      s.refreshed = true;
      const bad = await ensureToken(s, true);
      if (bad) return { kind: "stop", result: bad };
      continue;
    }
    if (a === "restart") {
      const bad = await restartSession(s);
      if (bad) return { kind: "stop", result: bad };
      continue;
    }
    return a;
  }
  return { kind: "stop", result: await transient(s, "YouTube's upload session didn't answer clearly.") };
}

// ─── finishing ──────────────────────────────────────────────────────────────

async function uploaded(s: Step, json: unknown): Promise<StepResult | null> {
  const id = json && typeof json === "object" ? (json as { id?: unknown }).id : null;
  if (typeof id !== "string" || !id) return fail(s, "YouTube took the file but didn't say which video it made. Check YouTube Studio.");
  const now = new Date().toISOString();
  const ok = await save(s, {
    status: "processing",
    youtube_video_id: id,
    youtube_url: `https://youtu.be/${id}`,
    bytes_sent: Number(s.row.bytes_total) || s.row.bytes_sent,
    upload_session_url: null,
    uploaded_at: now,
    consecutive_failures: 0,
    error: null,
  });
  if (!ok) return stopped(s);
  s.log.push(`Uploaded — https://youtu.be/${id}. YouTube is processing it.`);
  return null;
}

/** Write the listing's YouTube link if asked: only when empty, unless "replace" was ticked. */
async function writeListingLink(s: Step): Promise<boolean> {
  if (!s.row.set_listing_link || !s.row.listing_id || !s.row.youtube_url) return false;
  const { data: l } = await s.svc.from("listings").select("youtube_url").eq("id", s.row.listing_id).maybeSingle();
  if (!l) return false;
  const current = (l.youtube_url as string | null) ?? null;
  let q = s.svc.from("listings").update({ youtube_url: s.row.youtube_url }).eq("id", s.row.listing_id);
  if (!s.row.replace_listing_link) {
    if (current && current.trim()) {
      s.log.push("The listing already had a YouTube link, so it was left as it was.");
      return false;
    }
    // Compare-and-swap on the value just read, so a link typed meanwhile wins.
    q = current === null ? q.is("youtube_url", null) : q.eq("youtube_url", current);
  }
  const { data, error } = await q.select("id").maybeSingle();
  if (error || !data) {
    s.log.push(`The listing's YouTube link wasn't changed${error ? ` (${error.message})` : ""}.`);
    return false;
  }
  s.log.push("Put the YouTube link on the listing.");
  return true;
}

async function complete(s: Step, note?: string): Promise<StepResult> {
  const written = await writeListingLink(s);
  const now = new Date().toISOString();
  const ok = await save(s, { status: "done", finished_at: now, listing_link_written: written, error: null, consecutive_failures: 0 });
  if (!ok) return stopped(s);
  if (note) s.log.push(note);
  s.log.push(`On YouTube: ${s.row.youtube_url}`);
  return result(true, s, "done");
}

async function processingPhase(s: Step): Promise<StepResult> {
  const since = Date.parse(s.row.uploaded_at ?? s.row.updated_at);
  while (true) {
    if (Number.isFinite(since) && Date.now() - since > YOUTUBE_PROCESSING_MAX_MS) {
      return complete(s, "YouTube was still processing it after 20 minutes; it will finish on its own.");
    }
    // The video is on YouTube already: from here a problem only stops the
    // processing check, never fails the upload.
    let status = 0;
    let st: Awaited<ReturnType<typeof videoState>>["state"] = null;
    const t: AccessTokenResult = s.token ? { token: s.token } : await channelAccessToken(s.svc, s.row.channel_id as string);
    if (t.token) {
      s.token = t.token;
      const r = await videoState(t.token, s.row.youtube_video_id as string);
      status = r.status;
      st = r.state;
      if (status === 401 && !s.refreshed) {
        s.refreshed = true;
        s.token = null;
        const again = await channelAccessToken(s.svc, s.row.channel_id as string, { force: true });
        if (again.token) {
          s.token = again.token;
          continue;
        }
      }
    } else if (t.reconnect) {
      return complete(s, "Couldn't check YouTube's processing (the channel needs connecting again); the video is uploaded.");
    }

    if (status === 200) {
      if (st?.uploadStatus === "processed") return complete(s);
      if (st?.uploadStatus === "failed") return fail(s, `YouTube couldn't process the video${st.failureReason ? ` (${st.failureReason})` : ""}.`);
      if (st?.uploadStatus === "rejected") return fail(s, `YouTube rejected the video${st.rejectionReason ? ` (${st.rejectionReason})` : ""}.`);
      if (st?.uploadStatus === "deleted") return fail(s, "The video was deleted on YouTube.");
      if (s.row.consecutive_failures && !(await save(s, { consecutive_failures: 0 }))) return stopped(s);
    } else {
      const n = (s.row.consecutive_failures ?? 0) + 1;
      if (n >= YOUTUBE_MAX_CONSECUTIVE_FAILURES) return complete(s, "Couldn't read YouTube's processing status; the video is uploaded.");
      if (!(await save(s, { consecutive_failures: n }))) return stopped(s);
    }
    if (Date.now() + YOUTUBE_PROCESSING_POLL_MS + 5_000 > s.deadline) {
      await sleep(Math.min(YOUTUBE_PROCESSING_POLL_MS, s.deadline - Date.now()));
      return result(false, s);
    }
    await sleep(YOUTUBE_PROCESSING_POLL_MS);
  }
}

// ─── the upload phase ───────────────────────────────────────────────────────

async function uploadPhase(s: Step): Promise<StepResult> {
  const src = await videoSource(s);
  if ("finished" in src) return src;

  // 1. Size and type, once.
  if (!s.row.bytes_total) {
    const probe = await readRange(s, src.url, 0, 0);
    if (probe.error || !probe.total) return transient(s, `Couldn't read the video file (${probe.error ?? "size unknown"}).`);
    const ok = await save(s, {
      status: "uploading",
      bytes_total: probe.total,
      content_type: videoContentType(src.filename, probe.type),
      started_at: s.row.started_at ?? new Date().toISOString(),
    });
    if (!ok) return stopped(s);
  } else if (s.row.status === "queued") {
    if (!(await save(s, { status: "uploading" }))) return stopped(s);
  }
  const total = Number(s.row.bytes_total);

  // 2. A session, and where it got to.
  const tokenBad = await ensureToken(s);
  if (tokenBad) return tokenBad;
  let offset = 0;
  if (!s.row.upload_session_url) {
    const bad = await openSession(s);
    if (bad) return bad;
  } else {
    const a = await querySession(s);
    if (a.kind === "stop") return a.result;
    if (a.kind === "finished") {
      const bad = await uploaded(s, a.json);
      return bad ?? (await processingPhase(s));
    }
    offset = a.offset;
  }

  // 3. Chunks.
  let slowest = FIRST_CHUNK_GUESS_MS;
  let sent = 0;
  for (let chunk = nextChunk(offset, total, YOUTUBE_CHUNK_BYTES); chunk; chunk = nextChunk(offset, total, YOUTUBE_CHUNK_BYTES)) {
    if (sent > 0 && Date.now() + slowest * 1.3 > s.deadline) break;
    const t0 = Date.now();
    const piece = await readRange(s, src.url, chunk.start, chunk.end);
    if (piece.error || !piece.bytes) return transient(s, `Couldn't read the video file (${piece.error ?? "no data"}).`);
    if (piece.bytes.length !== chunk.size) return transient(s, `Storage returned ${piece.bytes.length} bytes instead of ${chunk.size}.`);

    const r = await googleFetch(s.row.upload_session_url as string, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${s.token}`,
        "Content-Length": String(chunk.size),
        "Content-Range": contentRange(chunk, total),
      },
      body: piece.bytes as unknown as BodyInit,
      timeoutMs: requestTimeout(s),
    });
    const a = await readSessionAnswer(s, r, "sending the video");
    if (a === "retry-auth") {
      s.refreshed = true;
      const bad = await ensureToken(s, true);
      if (bad) return bad;
      continue; // same chunk again (offset unchanged)
    }
    if (a === "restart") {
      const bad = await restartSession(s);
      if (bad) return bad;
      offset = 0;
      continue;
    }
    if (a.kind === "stop") return a.result;
    if (a.kind === "finished") {
      const bad = await uploaded(s, a.json);
      return bad ?? (await processingPhase(s));
    }
    // YouTube kept none of the chunk: don't spin on it, count it as a hiccup.
    if (a.offset <= chunk.start) return transient(s, "YouTube didn't keep the last piece of the video.");
    offset = a.offset;
    sent += chunk.size;
    slowest = Math.max(slowest, Date.now() - t0);
    if (!(await save(s, { bytes_sent: offset, consecutive_failures: 0, error: null }))) return stopped(s);
  }

  if (offset >= total) {
    // Every byte confirmed but no final answer yet: the next batch's status check gets it.
    s.log.push("Every byte is with YouTube; waiting for its answer.");
    return result(false, s);
  }
  s.log.push(`${mb(offset)} of ${mb(total)} sent (${Math.floor((offset / total) * 100)}%).`);
  return result(false, s);
}

export const youtubeUpload: JobHandler = async (job, ctx) => {
  const uploadId = typeof job.params?.uploadId === "string" ? (job.params.uploadId as string) : "";
  if (!uploadId) throw new JobFatalError("No upload given.");
  const { data, error } = await ctx.svc.from("youtube_uploads").select("*").eq("id", uploadId).maybeSingle();
  if (error) {
    if (isMissingYouTubeSchema(error)) throw new JobFatalError("The YouTube tables aren't in the database (migration 20261127_youtube_upload.sql).");
    throw new Error(error.message);
  }
  const started = Date.now();
  const s: Step = {
    svc: ctx.svc,
    row: data as UploadRow,
    started,
    deadline: Math.min(ctx.deadlineMs, started + YOUTUBE_TICK_BUDGET_MS),
    log: [],
    token: null,
    refreshed: false,
  };
  if (!data) return { cursor: null, done: 0, failed: 0, total: 1, log: ["That upload no longer exists."], finished: true };
  if (ACTIVE.indexOf(s.row.status) < 0) return { cursor: null, done: 0, failed: 0, total: 1, log: [`Nothing to do — the upload is ${s.row.status}.`], finished: true };
  if (!s.row.channel_id) return fail(s, "The YouTube channel was disconnected.");
  if (s.row.status === "processing") return processingPhase(s);
  return uploadPhase(s);
};
