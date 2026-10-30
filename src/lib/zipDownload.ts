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
 *    at most 400 MB (150 MB on phones / tablets), each zip streamed from
 *    photos fetched one at a time and saved as "<name> (part 1 of N).zip";
 *    a part the browser can't hold is halved and retried.
 *
 * Usage — open the target FIRST in the click handler, before any await (the
 * Save dialog needs the click's user activation), then sign the links, then
 * writeZip().
 */

import { makeZip } from "client-zip";

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
  // Oct 30: was ≤ 1 GB parts built from every photo Blob held in memory plus
  // a second Blob of the zip — up to 2 GB per part, which Safari refuses
  // ("file too large"). Now each part's zip is STREAMED from photos fetched
  // one at a time (only the zip being built is held — one copy), parts are
  // smaller, and a part the browser can't hold is split in two and retried.
  let limit = opts.partLimitBytes ?? partLimitBytes();

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
  const sizeOf = new Map<ZipEntry, number>();
  entries.forEach((e, i) => sizeOf.set(e, sizes[i]));
  const plan = (list: ZipEntry[], max: number): ZipEntry[][] => {
    const groups: ZipEntry[][] = [];
    let cur: ZipEntry[] = [];
    let curBytes = 0;
    for (const e of list) {
      const n = sizeOf.get(e) ?? 0;
      if (cur.length && curBytes + n > max) {
        groups.push(cur);
        cur = [];
        curBytes = 0;
      }
      cur.push(e);
      curBytes += n;
    }
    if (cur.length) groups.push(cur);
    return groups;
  };
  const queue = plan(entries, limit);
  let partNo = 0;
  progress.parts = queue.length;

  let written = 0;
  let saved = 0;
  const retried = new Set<ZipEntry[]>();
  while (queue.length) {
    const group = queue.shift()!;
    const before = { done: progress.done, failed: progress.failed, bytes: progress.bytes };
    let groupWritten = 0;
    progress.part = partNo + 1;
    report();

    // Photos fetched lazily, one at a time, as the zip asks for them.
    const files = async function* () {
      for (const e of group) {
        let res: Response | null = null;
        try {
          if (!e.url) throw new Error("no link");
          res = await fetchWithRetry(e.url);
        } catch {
          res = null;
        }
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
              groupWritten++;
              report();
            },
          })
        );
        const len = Number(res.headers.get("content-length"));
        yield {
          name: e.name,
          input: counted,
          lastModified: new Date(),
          ...(Number.isFinite(len) && len > 0 ? { size: len } : {}),
        };
      }
    };

    try {
      const zip = await new Response(makeZip(files())).blob();
      if (groupWritten > 0) {
        partNo++;
        const totalParts = partNo + queue.length;
        const name = totalParts > 1 ? `${opts.baseName} (part ${partNo} of ${totalParts}).zip` : `${opts.baseName}.zip`;
        saveBlob(new Blob([zip], { type: "application/zip" }), name);
        saved++;
        written += groupWritten;
        // Give the browser a moment to start saving before the next part is built.
        await sleep(800);
      }
    } catch (e) {
      // Undo this part's progress — it will be redone.
      progress.done = before.done;
      progress.failed = before.failed;
      progress.bytes = before.bytes;
      if (isTooLarge(e) && group.length > 1) {
        // The browser can't hold a part this big: halve the part size and
        // re-plan this part and every part after it (all would be too big).
        const groupBytes = group.reduce((t, x) => t + (sizeOf.get(x) ?? 0), 0);
        limit = Math.max(Math.floor(Math.min(limit, groupBytes) / 2), 25 * 1024 * 1024);
        const rest = [group, ...queue.splice(0)].flat();
        queue.push(...plan(rest, limit));
        progress.parts = partNo + queue.length;
        report();
        continue;
      }
      if (!isTooLarge(e) && !retried.has(group)) {
        // A connection dropped mid-photo: build this part once more.
        retried.add(group);
        queue.unshift(group);
        await sleep(1500);
        continue;
      }
      return {
        ok: false,
        error: isTooLarge(e)
          ? `This browser ran out of room for the zip${saved ? ` after ${saved} part${saved !== 1 ? "s" : ""}` : ""}. Choose Web & MLS from the size menu, or download Full resolution on a computer with Chrome or Edge.`
          : `The download stopped (${e instanceof Error ? e.message : "error"}). Please try again.`,
        written,
        failed: progress.failed,
      };
    }
  }
  if (written === 0) return { ok: false, error: "None of the photos could be downloaded.", written, failed: progress.failed };
  return { ok: true, written, failed: progress.failed, bytes: progress.bytes, parts: saved };
}

/** True when this browser has no Save dialog, so a zip goes out as parts. */
export function usesZipParts(): boolean {
  if (typeof window === "undefined") return true;
  return typeof (window as PickerWindow).showSaveFilePicker !== "function";
}

/** Largest part in parts mode: 400 MB on a computer, 150 MB on a phone / tablet. */
export function partLimitBytes(): number {
  return isTouchDevice() ? 150 * 1024 * 1024 : 400 * 1024 * 1024;
}

/** A browser "too big" error: memory, quota, Blob size (Safari: "file too large" / "The operation is insecure"). */
function isTooLarge(e: unknown): boolean {
  if (e instanceof RangeError) return true;
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (/QuotaExceeded|NotReadable|DataCloneError|SecurityError/i.test(name)) return true;
  return /too large|quota|out of memory|allocation|insecure|array buffer|exceeds/i.test(msg);
}

/** "1.2 GB" / "340 MB" for progress text. */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(0, Math.round(n / 1e3))} KB`;
}
