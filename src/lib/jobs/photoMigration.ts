/**
 * Background jobs that move photo ORIGINALS from Supabase Storage to R2
 * (Oct 28, 2026). Registered in ./runner.ts; started from /admin/storage.
 *
 *   photo_originals_copy     copy → verify → mark storage_backend = 'r2'.
 *                            NEVER deletes anything. Idempotent: only rows
 *                            still 'supabase' are picked up, so pausing
 *                            (cancel) and starting again simply carries on,
 *                            and failed rows are retried by the next run.
 *   photo_originals_cleanup  GATED (admin button + typed confirmation, never
 *                            automatic): removes the Supabase copy of rows
 *                            already 'r2', each one only after its R2 copy is
 *                            re-verified (HEAD size matches).
 *   site_photos_cleanup      GATED likewise: removes `site-photos` files of
 *                            boats whose live yachtpics.com page now points
 *                            at R2 (listings.site_photos_backend = 'r2').
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureDerivatives } from "@/lib/photoDerivatives";
import { deleteR2Original, headR2Original, putR2Original, PHOTO_BUCKET, r2PhotosConfigured, noteR2PhotoExists } from "@/lib/photoStore";
import { originalContentType } from "@/lib/photoStoreShared";
import { DOWNLOAD_SIZE_EDGES, downloadSizeExt, downloadSizePath, type DownloadSizeName } from "@/lib/photoDerivativePaths";
import { r2Configured, r2Exists } from "@/lib/r2";
import { JobFatalError, type JobHandler } from "./types";

/** Photos per worker step (one ~40 s batch). */
export const COPY_BATCH = 50;
const COPY_CONCURRENCY = 3; // sharp work is serialised per instance; keeps a batch inside the step budget
const CLEANUP_BATCH = 200;
const SITE_BUCKET = "site-photos";

/** The phrase an admin types to allow a cleanup job. */
export const CLEANUP_CONFIRM_PHRASE = "DELETE SUPABASE COPIES";

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(2)} GB`;

type CopyRow = { id: string; storage_path: string; derivatives_at: string | null };

/** Copy one original to R2 and verify it. Returns bytes copied, or throws. */
async function copyOne(svc: SupabaseClient, row: CopyRow): Promise<number> {
  // Derivatives first, while Supabase can still resize the original directly.
  if (!row.derivatives_at) {
    await ensureDerivatives([row.id], { svc, concurrency: 1 }).catch(() => null);
  }

  const { data: signed, error: signErr } = await svc.storage.from(PHOTO_BUCKET).createSignedUrl(row.storage_path, 600);
  if (signErr || !signed?.signedUrl) throw new Error(`source: ${signErr?.message ?? "couldn't sign"}`);
  const res = await fetch(signed.signedUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`source: HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("source: empty file");
  if (Number.isFinite(declared) && declared > 0 && declared !== bytes.byteLength) {
    throw new Error(`source: read ${bytes.byteLength} of ${declared} bytes`);
  }
  const headerType = (res.headers.get("content-type") || "").split(";")[0].trim();
  const contentType = headerType && headerType !== "application/octet-stream" ? headerType : originalContentType(row.storage_path);

  // Already there (an earlier run died after uploading)? Same size → reuse.
  const existing = await headR2Original(row.storage_path);
  const wroteNow = !(existing && existing.size === bytes.byteLength);
  if (wroteNow) {
    await putR2Original(row.storage_path, bytes, contentType);
  }

  const head = await headR2Original(row.storage_path);
  if (!head) throw new Error("verify: not found on R2 after upload");
  if (head.size !== bytes.byteLength) throw new Error(`verify: R2 has ${head.size} bytes, source ${bytes.byteLength}`);
  if (existing === null || existing.size !== bytes.byteLength) {
    if ((head.contentType || "") !== contentType) throw new Error(`verify: R2 type ${head.contentType}, expected ${contentType}`);
  }

  // The Web & MLS / Social download files, made now from the bytes in hand
  // (sharp) and stored in R2 — so moved photos download as fast as new ones.
  // Best effort: a photo sharp can't read gets them on demand later.
  let downloadSizes: Record<string, unknown> | null = null;
  try {
    const { makeDownloadSizes } = await import("@/lib/photoSharp");
    const made = await makeDownloadSizes(bytes, row.storage_path);
    const type = downloadSizeExt(row.storage_path) === "png" ? "image/png" : "image/jpeg";
    const rec: Record<string, unknown> = { path: row.storage_path, w: made.width, h: made.height };
    if (made.webOriginal) rec.web_original = true;
    for (const [name, buf] of Array.from(made.files.entries())) {
      await putR2Original(downloadSizePath(row, name), new Uint8Array(buf), type);
      rec[name] = buf.byteLength;
    }
    downloadSizes = rec;
  } catch {
    downloadSizes = null;
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await svc
    .from("photos")
    .update({
      storage_backend: "r2",
      r2_verified_at: now,
      original_bytes: bytes.byteLength,
      r2_copy_error: null,
      ...(downloadSizes ? { download_sizes: downloadSizes } : {}),
    })
    .eq("id", row.id)
    .eq("storage_path", row.storage_path) // replaced meanwhile → leave it
    .eq("storage_backend", "supabase")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`db: ${error.message}`);
  if (updated) {
    noteR2PhotoExists();
    return bytes.byteLength;
  }
  // The row was deleted or its file replaced while copying: remove the R2
  // object this run just wrote (only that R2 key; Supabase is untouched),
  // unless some photos row still uses the path.
  if (wroteNow || downloadSizes) {
    const { count } = await svc.from("photos").select("id", { count: "exact", head: true }).eq("storage_path", row.storage_path);
    if ((count ?? 0) === 0) {
      if (wroteNow) await deleteR2Original(row.storage_path).catch(() => {});
      if (downloadSizes) {
        await Promise.all(
          (Object.keys(DOWNLOAD_SIZE_EDGES) as DownloadSizeName[]).map((n) => deleteR2Original(downloadSizePath(row, n)).catch(() => {}))
        );
      }
    }
  }
  return 0;
}

export const photoOriginalsCopy: JobHandler = async (job, { svc, deadlineMs }) => {
  if (!r2PhotosConfigured()) throw new JobFatalError("R2 isn't configured (R2_ACCOUNT_ID / keys / bucket missing).");
  const cur = (job.cursor ?? {}) as { lastId?: string; bytes?: number };

  let total: number | undefined;
  if (job.total == null) {
    const { count, error } = await svc.from("photos").select("id", { count: "exact", head: true }).eq("storage_backend", "supabase");
    if (error) throw new Error(error.message);
    total = count ?? 0;
  }

  let q = svc
    .from("photos")
    .select("id, storage_path, derivatives_at")
    .eq("storage_backend", "supabase")
    .order("id", { ascending: true })
    .limit(COPY_BATCH);
  if (cur.lastId) q = q.gt("id", cur.lastId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as CopyRow[];

  let done = 0;
  let failed = 0;
  let bytes = 0;
  let lastId = cur.lastId;
  const errors: string[] = [];
  let next = 0;
  let processedUpTo = -1;
  const finishedIdx = new Set<number>();

  const lanes = Array.from({ length: Math.min(COPY_CONCURRENCY, rows.length) }, async () => {
    while (next < rows.length) {
      // Leave time to save progress; anything not started waits for the next step.
      if (Date.now() > deadlineMs - 6000) return;
      const i = next++;
      const row = rows[i];
      try {
        const n = await copyOne(svc, row);
        bytes += n;
        done++;
      } catch (e) {
        failed++;
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        if (errors.length < 5) errors.push(`${row.id.slice(0, 8)}… ${msg}`);
        await svc.from("photos").update({ r2_copy_error: msg }).eq("id", row.id).then(() => {}, () => {});
      }
      finishedIdx.add(i);
    }
  });
  await Promise.all(lanes);

  // The cursor only moves past a contiguous run of finished rows, so a row
  // that never started is picked up next time.
  while (finishedIdx.has(processedUpTo + 1)) processedUpTo++;
  if (processedUpTo >= 0) lastId = rows[processedUpTo].id;

  const totalBytes = (cur.bytes ?? 0) + bytes;
  const finished = rows.length < COPY_BATCH && processedUpTo === rows.length - 1;
  const log = [
    `${done} copied (${gb(bytes)})${failed ? `, ${failed} failed` : ""} · ${gb(totalBytes)} so far`,
    ...errors.map((e) => `  ${e}`),
  ];
  if (finished) {
    log.push(
      `Finished — ${job.done + done} originals copied to R2${job.failed + failed ? `, ${job.failed + failed} failed (start again to retry them)` : ""}. Nothing was deleted from Supabase.`
    );
  }
  return { cursor: { lastId, bytes: totalBytes }, done, failed, total, log, finished };
};

function requireConfirmed(params: Record<string, unknown>) {
  if (params.confirm !== CLEANUP_CONFIRM_PHRASE) {
    throw new JobFatalError("This cleanup wasn't confirmed — start it from the Storage page.");
  }
}

export const photoOriginalsCleanup: JobHandler = async (job, { svc, deadlineMs }) => {
  requireConfirmed(job.params);
  if (!r2PhotosConfigured()) throw new JobFatalError("R2 isn't configured — can't verify copies, so nothing is removed.");
  const cur = (job.cursor ?? {}) as { lastId?: string; bytes?: number };

  let total: number | undefined;
  if (job.total == null) {
    const { count } = await svc
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("storage_backend", "r2")
      .is("supabase_removed_at", null);
    total = count ?? 0;
  }

  let q = svc
    .from("photos")
    .select("id, storage_path, original_bytes")
    .eq("storage_backend", "r2")
    .is("supabase_removed_at", null)
    .order("id", { ascending: true })
    .limit(CLEANUP_BATCH);
  if (cur.lastId) q = q.gt("id", cur.lastId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; storage_path: string; original_bytes: number | null }[];
  if (rows.length === 0) {
    return { cursor: cur, done: 0, failed: 0, total, log: ["Finished — no Supabase copies left to remove."], finished: true };
  }

  // A path some OTHER row still reads from Supabase is never removed.
  const paths = rows.map((r) => r.storage_path);
  const { data: stillSupabase } = await svc
    .from("photos")
    .select("storage_path")
    .eq("storage_backend", "supabase")
    .in("storage_path", paths);
  const protectedPaths = new Set((stillSupabase ?? []).map((r) => r.storage_path as string));

  const verified: typeof rows = [];
  let failed = 0;
  const errors: string[] = [];
  let processed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < rows.length) {
        if (Date.now() > deadlineMs - 8000) return;
        const r = rows[next++];
        const head = await headR2Original(r.storage_path);
        const ok = !!head && head.size > 0 && (r.original_bytes == null || head.size === r.original_bytes) && !protectedPaths.has(r.storage_path);
        if (ok) verified.push(r);
        else {
          failed++;
          const why = !head ? "R2 copy missing" : protectedPaths.has(r.storage_path) ? "another photo uses this file on Supabase" : `R2 size ${head.size} ≠ ${r.original_bytes}`;
          if (errors.length < 5) errors.push(`${r.id.slice(0, 8)}… kept: ${why}`);
          await svc.from("photos").update({ r2_copy_error: `cleanup: ${why}` }).eq("id", r.id).then(() => {}, () => {});
        }
        processed++;
      }
    })
  );

  // Remove the verified Supabase copies, then mark them.
  let removedBytes = 0;
  for (let i = 0; i < verified.length; i += 100) {
    const chunk = verified.slice(i, i + 100);
    const { error: rmErr } = await svc.storage.from(PHOTO_BUCKET).remove(chunk.map((r) => r.storage_path));
    if (rmErr) throw new Error(`remove: ${rmErr.message}`);
    await svc
      .from("photos")
      .update({ supabase_removed_at: new Date().toISOString() })
      .in("id", chunk.map((r) => r.id));
    removedBytes += chunk.reduce((s, r) => s + (r.original_bytes ?? 0), 0);
  }

  // Rows kept (failed verification) stay unmarked; move past everything looked at.
  const looked = rows.slice(0, processed);
  const lastId = looked.length ? looked.reduce((m, r) => (r.id > m ? r.id : m), looked[0].id) : cur.lastId;
  const totalBytes = (cur.bytes ?? 0) + removedBytes;
  const finished = rows.length < CLEANUP_BATCH && processed === rows.length;
  const log = [
    `${verified.length} Supabase copies removed (${gb(removedBytes)})${failed ? `, ${failed} kept` : ""} · ${gb(totalBytes)} freed so far`,
    ...errors.map((e) => `  ${e}`),
  ];
  if (finished) log.push(`Finished — ${job.done + verified.length} removed${job.failed + failed ? `, ${job.failed + failed} kept (see the log)` : ""}.`);
  return { cursor: { lastId, bytes: totalBytes }, done: verified.length, failed, total, log, finished };
};

export const sitePhotosCleanup: JobHandler = async (job, { svc, deadlineMs }) => {
  requireConfirmed(job.params);
  if (!r2Configured()) throw new JobFatalError("The public R2 media host isn't configured — nothing is removed.");
  const cur = (job.cursor ?? {}) as { lastId?: string };

  const base = () =>
    svc
      .from("listings")
      .select("id, vessel_name, site_page, site_slug")
      .eq("site_photos_backend", "r2")
      .not("site_page", "is", null)
      .not("site_slug", "is", null);

  let total: number | undefined;
  if (job.total == null) {
    const { count } = await svc
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("site_photos_backend", "r2")
      .not("site_page", "is", null)
      .not("site_slug", "is", null);
    total = count ?? 0;
  }

  let q = base().order("id", { ascending: true }).limit(5);
  if (cur.lastId) q = q.gt("id", cur.lastId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const boats = (data ?? []) as { id: string; vessel_name: string | null; site_page: string; site_slug: string }[];

  let done = 0;
  let failed = 0;
  let lastId = cur.lastId;
  const log: string[] = [];
  for (const b of boats) {
    if (Date.now() > deadlineMs - 10_000 && done + failed > 0) break;
    const folder = `${b.site_page}/${b.site_slug}`;
    const { data: visible } = await svc.from("photos").select("id").eq("listing_id", b.id).eq("is_visible", true);
    const onPage = new Set((visible ?? []).map((p) => p.id as string));

    const names: string[] = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
      const { data: objs, error: lErr } = await svc.storage.from(SITE_BUCKET).list(folder, { limit: 1000, offset });
      if (lErr) throw new Error(`list ${folder}: ${lErr.message}`);
      (objs ?? []).forEach((o) => { if (o.name && o.id) names.push(o.name); });
      if ((objs ?? []).length < 1000) break;
    }

    // A file whose photo is on the live page goes only when its R2 copy is there.
    const removable: string[] = [];
    let kept = 0;
    for (const name of names) {
      const photoId = name.split(".")[0];
      if (onPage.has(photoId) && !(await r2Exists(`${folder}/${name}`))) {
        kept++;
        continue;
      }
      removable.push(`${folder}/${name}`);
    }
    for (let i = 0; i < removable.length; i += 100) {
      const { error: rmErr } = await svc.storage.from(SITE_BUCKET).remove(removable.slice(i, i + 100));
      if (rmErr) throw new Error(`remove: ${rmErr.message}`);
    }
    const name = b.vessel_name || folder;
    if (kept) {
      failed++;
      log.push(`${name} — ${removable.length} removed, ${kept} kept (not on the media host yet — re-publish this boat, then run again)`);
    } else {
      done++;
      log.push(`${name} — ${removable.length} removed`);
    }
    lastId = b.id;
  }
  const finished = boats.length < 5 && lastId === (boats.length ? boats[boats.length - 1].id : lastId);
  if (finished) log.push(`Finished — ${job.done + done} boats cleaned${job.failed + failed ? `, ${job.failed + failed} with files kept` : ""}.`);
  return { cursor: { lastId }, done, failed, total, log, finished };
};

// ─── r2_photo_finish ────────────────────────────────────────────────────────
// Queued by the upload step of originals on R2 (which waits only for the 600
// tile): makes the 2000 copy (sets derivatives_at) and the Web / Social
// download files for every R2 photo still missing them, newest first. The
// queue is the photos table itself. A photo that keeps failing is skipped for
// the rest of this job (cursor.skip); the daily derivatives cron and the
// on-demand download path still cover it. download_sizes gets a marker on
// failure so this job doesn't loop on it (downloads then retry on demand).
export const r2PhotoFinish: JobHandler = async (job, { svc, deadlineMs }) => {
  const cur = (job.cursor ?? {}) as { skip?: string[] };
  const skip = new Set(cur.skip ?? []);
  const { ensureDerivatives } = await import("@/lib/photoDerivatives");
  const { storeDownloadSizes } = await import("@/lib/photoSharp");
  let done = 0;
  let failed = 0;
  const log: string[] = [];
  let exhausted = false;
  while (Date.now() < deadlineMs - 8000) {
    const { data, error } = await svc
      .from("photos")
      .select("id, storage_path, derivatives_at, download_sizes")
      .eq("storage_backend", "r2")
      .or("derivatives_at.is.null,download_sizes.is.null")
      .order("created_at", { ascending: false })
      .limit(20 + skip.size);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as { id: string; storage_path: string; derivatives_at: string | null; download_sizes: unknown }[])
      .filter((r) => !skip.has(r.id));
    if (rows.length === 0) {
      exhausted = true;
      break;
    }
    for (const r of rows) {
      if (Date.now() > deadlineMs - 8000) break;
      try {
        if (!r.derivatives_at) {
          // Both sizes + (via sharp, or the staged copy for HEIC) the download files.
          const e = await ensureDerivatives([r.id], { svc, concurrency: 1, force: false });
          if (e.failed.length) throw new Error(e.failed[0].reason);
        } else if (!r.download_sizes) {
          await storeDownloadSizes(svc, r).catch(async (err) => {
            await svc.from("photos").update({ download_sizes: { path: r.storage_path, error: String(err).slice(0, 200) } })
              .eq("id", r.id).then(() => {}, () => {});
            throw err;
          });
        }
        // Still nothing recorded for the download files (e.g. both ways failed
        // inside ensureDerivatives): mark it so the job moves on.
        const { data: after } = await svc.from("photos").select("derivatives_at, download_sizes").eq("id", r.id).maybeSingle();
        if (after && after.derivatives_at && !after.download_sizes) {
          await svc.from("photos").update({ download_sizes: { path: r.storage_path, error: "not made" } }).eq("id", r.id);
        }
        if (after && !after.derivatives_at) skip.add(r.id);
        done++;
      } catch (e) {
        failed++;
        skip.add(r.id);
        if (log.length < 5) log.push(`${r.id.slice(0, 8)}… ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
      }
    }
  }
  log.unshift(`${done} photo${done === 1 ? "" : "s"} finished${failed ? `, ${failed} failed` : ""}`);
  return { cursor: { skip: Array.from(skip).slice(-500) }, done, failed, log, finished: exhausted };
};
