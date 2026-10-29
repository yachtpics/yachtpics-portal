"use client";

/**
 * "Download all" as a STREAMING zip (Oct 29, 2026).
 *
 * The old way (JSZip) built the whole zip in memory and then handed the
 * browser one Blob. A full-resolution shoot is 5–8 GB (Sanibella: 194 photos,
 * ~7.5 GB) — no browser can hold that, so the button sat at "Zipping… 100%"
 * forever.
 *
 * Now:
 *  - Chrome / Edge desktop (showSaveFilePicker): the zip is written straight
 *    into the file the user picks, photo by photo, as each one downloads —
 *    memory stays flat whatever the size. Zip64, store mode (photos are
 *    already compressed), via client-zip.
 *  - Elsewhere (Safari, iPhone, Firefox): the photos are split into parts of
 *    at most ~1 GB (smaller on phones / tablets), each saved as
 *    "<name> (part 1 of N).zip" one after another.
 *
 * Usage — open the target FIRST in the click handler, before any await (the
 * Save dialog needs the click's user activation), then sign the links, then
 * writeZip().
 */

import { downloadZip, makeZip } from "client-zip";

export type ZipEntry = {
  /** Path inside the zip, e.g. "Sea Dream/01 Salon.jpg". */
  name: string;
  /** Link to fetch; entries without one are counted as failed. */
  url: string | null | undefined;
  /** Known size in bytes, if any (used to plan parts). */
  size?: number | null;
};

export type ZipProgress = {
  /** Photos finished (written or failed). */
  done: number;
  total: number;
  failed: number;
  /** Bytes of photo data written so far. */
  bytes: number;
  /** Parts mode only. */
  part?: number;
  parts?: number;
};

export type ZipTarget =
  | { kind: "stream"; writable: WritableStream<Uint8Array>; name: string }
  | { kind: "parts" }
  | { kind: "cancelled" };

export type ZipResult =
  | { ok: true; written: number; failed: number; bytes: number; parts: number }
  | { ok: false; error: string; written: number; failed: number };

type PickerWindow = Window & {
  showSaveFilePicker?: (opts: unknown) => Promise<{ name?: string; createWritable: () => Promise<WritableStream<Uint8Array>> }>;
};

/**
 * Open where the zip goes. Call it first thing in the click handler. A
 * cancelled Save dialog comes back as { kind: "cancelled" } (reset the button);
 * a browser without the dialog, or one that refuses it, gets parts mode.
 */
export async function openZipTarget(suggestedName: string): Promise<ZipTarget> {
  const w = window as PickerWindow;
  if (typeof w.showSaveFilePicker !== "function") return { kind: "parts" };
  try {
    const handle = await w.showSaveFilePicker({
      suggestedName,
      types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
    });
    const writable = await handle.createWritable();
    return { kind: "stream", writable, name: handle.name ?? suggestedName };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return { kind: "cancelled" };
    // SecurityError (no user activation left), unsupported context, …
    return { kind: "parts" };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with two retries on 429 / 5xx / network errors. */
async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(800 * attempt + Math.random() * 400);
    try {
      const res = await fetch(url, { cache: "no-store", ...init });
      if (res.ok) return res;
      if (!(res.status === 429 || res.status >= 500)) throw new Error(`HTTP ${res.status}`);
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e;
      if (e instanceof Error && /^HTTP 4/.test(e.message)) break;
    }
  }
  throw last instanceof Error ? last : new Error("download failed");
}

function isTouchDevice(): boolean {
  return typeof window !== "undefined" && (("ontouchstart" in window) || navigator.maxTouchPoints > 0) && !window.matchMedia?.("(pointer: fine)").matches;
}

/** Save a Blob as a file (parts mode). The object URL is revoked later — revoking at once can cancel the save on Safari. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/**
 * Write the zip. Stream mode pipes it into the picked file; parts mode
 * builds ≤ partLimit zips one after another, named "<baseName> (part i of N).zip"
 * (or "<baseName>.zip" when one part is enough). A photo that can't be
 * fetched is skipped and counted; a failure mid-write ends with ok:false and
 * an error to show (never a silent hang).
 */
export async function writeZip(
  target: Exclude<ZipTarget, { kind: "cancelled" }>,
  entries: ZipEntry[],
  opts: { baseName: string; onProgress?: (p: ZipProgress) => void; partLimitBytes?: number }
): Promise<ZipResult> {
  const total = entries.length;
  const progress: ZipProgress = { done: 0, total, failed: 0, bytes: 0 };
  const report = () => opts.onProgress?.({ ...progress });
  report();

  if (target.kind === "stream") {
    // One photo downloading ahead while the previous one is written.
    const start = (e: ZipEntry): Promise<Response | null> =>
      e.url ? fetchWithRetry(e.url).catch(() => null) : Promise.resolve(null);

    const files = async function* () {
      let next: Promise<Response | null> | null = entries.length ? start(entries[0]) : null;
      for (let i = 0; i < entries.length; i++) {
        const res = await next;
        next = i + 1 < entries.length ? start(entries[i + 1]) : null;
        if (!res || !res.body) {
          progress.failed++;
          progress.done++;
          report();
          continue;
        }
        const counted = res.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, ctl) {
              progress.bytes += chunk.byteLength;
              ctl.enqueue(chunk);
            },
            flush() {
              progress.done++;
              report();
            },
          })
        );
        const len = Number(res.headers.get("content-length"));
        yield {
          name: entries[i].name,
          input: counted,
          lastModified: new Date(),
          ...(Number.isFinite(len) && len > 0 ? { size: len } : {}),
        };
      }
    };

    try {
      await makeZip(files()).pipeTo(target.writable);
      const written = total - progress.failed;
      if (written === 0) return { ok: false, error: "None of the photos could be downloaded.", written, failed: progress.failed };
      return { ok: true, written, failed: progress.failed, bytes: progress.bytes, parts: 1 };
    } catch (e) {
      try { await target.writable.abort(); } catch { /* already closed */ }
      return {
        ok: false,
        error: `The download stopped partway (${e instanceof Error ? e.message : "connection lost"}). Please try again.`,
        written: progress.done - progress.failed,
        failed: progress.failed,
      };
    }
  }

  // ── parts mode ──────────────────────────────────────────────────────────
  const limit = opts.partLimitBytes ?? (isTouchDevice() ? 300 * 1024 * 1024 : 1024 * 1024 * 1024);

  // Sizes, to plan the parts: known ones as given; the rest from a 1-byte
  // ranged GET (Content-Range carries the total). Unknown → 40 MB.
  const sizes = await Promise.all(
    entries.map(async (e) => {
      if (e.size && e.size > 0) return e.size;
      if (!e.url) return 0;
      try {
        const r = await fetch(e.url, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
        const total = Number((r.headers.get("content-range") || "").split("/")[1]);
        r.body?.cancel().catch(() => {});
        if (Number.isFinite(total) && total > 0) return total;
        const len = Number(r.headers.get("content-length"));
        return Number.isFinite(len) && len > 1 ? len : 40 * 1024 * 1024;
      } catch {
        return 40 * 1024 * 1024;
      }
    })
  );
  const groups: ZipEntry[][] = [];
  let cur: ZipEntry[] = [];
  let curBytes = 0;
  entries.forEach((e, i) => {
    if (cur.length && curBytes + sizes[i] > limit) {
      groups.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(e);
    curBytes += sizes[i];
  });
  if (cur.length) groups.push(cur);
  progress.parts = groups.length;

  let written = 0;
  try {
    for (let g = 0; g < groups.length; g++) {
      progress.part = g + 1;
      report();
      const files: { name: string; input: Blob; lastModified: Date }[] = [];
      for (const e of groups[g]) {
        try {
          if (!e.url) throw new Error("no link");
          const res = await fetchWithRetry(e.url);
          const blob = await res.blob();
          progress.bytes += blob.size;
          files.push({ name: e.name, input: blob, lastModified: new Date() });
          written++;
        } catch {
          progress.failed++;
        }
        progress.done++;
        report();
      }
      if (files.length === 0) continue;
      const zip = await downloadZip(files).blob();
      const name = groups.length > 1 ? `${opts.baseName} (part ${g + 1} of ${groups.length}).zip` : `${opts.baseName}.zip`;
      saveBlob(zip, name);
      // Give the browser a moment to start saving before the next part is built.
      await sleep(600);
    }
  } catch (e) {
    return { ok: false, error: `The download stopped (${e instanceof Error ? e.message : "error"}). Please try again.`, written, failed: progress.failed };
  }
  if (written === 0) return { ok: false, error: "None of the photos could be downloaded.", written, failed: progress.failed };
  return { ok: true, written, failed: progress.failed, bytes: progress.bytes, parts: groups.length };
}

/** "1.2 GB" / "340 MB" for progress text. */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(0, Math.round(n / 1e3))} KB`;
}
