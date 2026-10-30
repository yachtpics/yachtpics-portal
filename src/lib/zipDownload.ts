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
 *    already compressed), written by writeStoredZip below.
 *  - Elsewhere (Safari, iPhone, Firefox): the photos are split into parts of
 *    at most 400 MB (150 MB on phones / tablets), each zip streamed from
 *    photos fetched one at a time and saved as "<name> (part 1 of N).zip";
 *    a part the browser can't hold is halved and retried.
 *
 * If the Save-dialog file fails to write (some PCs: OneDrive folders, managed
 * PCs, "file too large"), the same zip is redone in parts mode; embedded
 * browsers (Outlook / Teams WebViews) use parts mode from the start. Failures
 * are reported to /api/photos/download-fallback (Vercel logs).
 *
 * Usage — open the target FIRST in the click handler, before any await (the
 * Save dialog needs the click's user activation), then sign the links, then
 * writeZip().
 */

// ── The zip writer (Oct 30) ───────────────────────────────────────────────
// client-zip streams each photo with unknown CRC / size: every local header
// carried zeros, a data descriptor (flag bit 3) and "version 4.5" (ZIP64).
// Windows' built-in zip folder then misreads the files — Kyle Blom opened
// the zip in Explorer without extracting and dragged photos into an
// uploader: "file too large" (the old JSZip zips worked). So zips are now
// written here, store mode, one photo at a time held in memory: CRC and
// sizes go in the local header, no data descriptor, version 2.0 — the
// classic layout every unzipper reads. ZIP64 only where the spec needs it
// (an entry starting past 4 GB, or > 65 535 entries / a 4 GB+ archive);
// Explorer can't open those anyway and "Save to a folder" covers them.

/** One file for writeStoredZip: the whole photo in memory, CRC computed here. */
export type StoredFile = { name: string; data: Uint8Array; lastModified?: Date };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date / time (local), as zip headers store them. */
function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, Math.min(2107, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const MAX32 = 0xffffffff;

/**
 * A zip (store mode) of these files, as a stream. Each file's local header
 * carries its CRC-32 and sizes; no data descriptors. Non-ASCII names are
 * flagged UTF-8 (bit 11) so Windows shows them right.
 */
export function writeStoredZip(files: AsyncIterable<StoredFile>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  async function* gen(): AsyncGenerator<Uint8Array> {
    const central: Uint8Array[] = [];
    let offset = 0; // where the next local header starts
    let count = 0;
    for await (const f of files) {
      const name = enc.encode(f.name);
      const flags = /[\u0080-\uffff]/.test(f.name) ? 0x0800 : 0;
      const size = f.data.byteLength;
      if (size >= MAX32) throw new RangeError("A single file over 4 GB can't go in this zip.");
      const crc = crc32(f.data);
      const { time, date } = dosDateTime(f.lastModified ?? new Date());
      const far = offset >= MAX32; // this entry starts past 4 GB → ZIP64 offset
      const version = far ? 45 : 20;

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, version, true);
      lh.setUint16(6, flags, true);
      lh.setUint16(8, 0, true); // stored
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      yield new Uint8Array(lh.buffer);
      yield name;
      yield f.data;

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, version, true); // made by: MS-DOS / FAT, spec version
      cd.setUint16(6, version, true);
      cd.setUint16(8, flags, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, size, true);
      cd.setUint32(24, size, true);
      cd.setUint16(28, name.length, true);
      cd.setUint16(30, far ? 12 : 0, true);
      cd.setUint32(38, 0x20, true); // FAT "archive" attribute
      cd.setUint32(42, far ? MAX32 : offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      if (far) {
        const x = new DataView(new ArrayBuffer(12));
        x.setUint16(0, 0x0001, true);
        x.setUint16(2, 8, true);
        x.setBigUint64(4, BigInt(offset), true);
        central.push(new Uint8Array(x.buffer));
      }
      offset += 30 + name.length + size;
      count++;
    }

    let cdSize = 0;
    for (const c of central) {
      yield c;
      cdSize += c.byteLength;
    }
    const cdStart = offset;
    if (count >= 0xffff || cdStart >= MAX32 || cdSize >= MAX32) {
      const z = new DataView(new ArrayBuffer(56 + 20));
      z.setUint32(0, 0x06064b50, true);
      z.setBigUint64(4, BigInt(44), true);
      z.setUint16(12, 45, true);
      z.setUint16(14, 45, true);
      z.setBigUint64(24, BigInt(count), true);
      z.setBigUint64(32, BigInt(count), true);
      z.setBigUint64(40, BigInt(cdSize), true);
      z.setBigUint64(48, BigInt(cdStart), true);
      z.setUint32(56, 0x07064b50, true);
      z.setBigUint64(64, BigInt(cdStart + cdSize), true);
      z.setUint32(72, 1, true);
      yield new Uint8Array(z.buffer);
    }
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, Math.min(count, 0xffff), true);
    e.setUint16(10, Math.min(count, 0xffff), true);
    e.setUint32(12, Math.min(cdSize, MAX32), true);
    e.setUint32(16, Math.min(cdStart, MAX32), true);
    yield new Uint8Array(e.buffer);
  }
  const it = gen();
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      const { value, done } = await it.next();
      if (done) ctl.close();
      else ctl.enqueue(value);
    },
    async cancel(reason) {
      await it.throw?.(reason).catch(() => {});
    },
  });
}

/** A whole photo as bytes (fetch → ArrayBuffer), or null if it can't be had. */
async function fetchBytes(url: string | null | undefined): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const res = await fetchWithRetry(url);
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

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
  chrome?: unknown;
};

/** Who / what a zip is for — sent with diagnostics (no PII; the server adds the user id). */
export type ZipContext = { listingId?: string | null; size?: string | null };

/**
 * Diagnostics (Oct 30): a zip that fails, or a Save-dialog stream that falls
 * back to parts, is reported to /api/photos/download-fallback, which writes
 * one `[download-fallback]` line to the Vercel runtime logs. Fire-and-forget.
 */
export function reportZipIssue(step: string, err: unknown, extra: ZipContext & { mode?: string; bytes?: number; done?: number; total?: number } = {}) {
  try {
    const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : typeof err;
    const message = err instanceof Error ? err.message : String(err ?? "");
    fetch("/api/photos/download-fallback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ step, errorName: name, message, ...extra }),
    }).catch(() => {});
  } catch { /* diagnostics never break a download */ }
}

/**
 * An embedded browser (Outlook / Teams / an app's WebView) — the Save dialog
 * there may exist but fail to write, so these always use parts mode.
 */
function isEmbeddedWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/WebView|; wv\)|\bTeams\/|Electron\/|Outlook|ms-office|MSOffice/i.test(ua)) return true;
  const w = window as PickerWindow;
  return typeof w.showSaveFilePicker === "function" && !w.chrome;
}

/**
 * Open where the zip goes. Call it first thing in the click handler. A
 * cancelled Save dialog comes back as { kind: "cancelled" } (reset the button);
 * a browser without the dialog, or one that refuses it, gets parts mode.
 */
export async function openZipTarget(suggestedName: string, ctx: ZipContext = {}): Promise<ZipTarget> {
  const w = window as PickerWindow;
  if (typeof w.showSaveFilePicker !== "function") return { kind: "parts" };
  if (isEmbeddedWebView()) return { kind: "parts" };
  let step = "picker";
  try {
    const handle = await w.showSaveFilePicker({
      suggestedName,
      types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
    });
    step = "createWritable";
    const writable = await handle.createWritable();
    return { kind: "stream", writable, name: handle.name ?? suggestedName };
  } catch (e) {
    if (step === "picker" && e instanceof DOMException && e.name === "AbortError") return { kind: "cancelled" };
    // SecurityError (no user activation left), a managed PC that blocks the
    // file, unsupported context, … → parts mode (plain downloads).
    reportZipIssue(step, e, { ...ctx, mode: "stream→parts" });
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
      if (init?.signal?.aborted) break;
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
  opts: { baseName: string; onProgress?: (p: ZipProgress) => void; partLimitBytes?: number; context?: ZipContext }
): Promise<ZipResult> {
  const total = entries.length;
  let progress: ZipProgress = { done: 0, total, failed: 0, bytes: 0 };
  const report = () => opts.onProgress?.({ ...progress });
  report();

  if (target.kind === "stream") {
    // The stream's own counters (`sp`): if it falls back, late callbacks of
    // the abandoned stream can't touch the parts-mode progress.
    const sp = progress;
    const reportStream = () => { if (progress === sp) report(); };
    let abandoned = false;
    // One photo downloading ahead while the previous one is written; each
    // is held whole (CRC + size go in its header) — two in memory at most.
    const files = async function* (): AsyncGenerator<StoredFile> {
      let next: Promise<Uint8Array | null> | null = entries.length ? fetchBytes(entries[0].url) : null;
      for (let i = 0; i < entries.length; i++) {
        const data = await next;
        if (abandoned) return;
        next = i + 1 < entries.length ? fetchBytes(entries[i + 1].url) : null;
        if (!data) {
          sp.failed++;
          sp.done++;
          reportStream();
          continue;
        }
        yield { name: entries[i].name, data, lastModified: new Date() };
        sp.bytes += data.byteLength;
        sp.done++;
        reportStream();
      }
    };

    try {
      await writeStoredZip(files()).pipeTo(target.writable);
      const written = total - sp.failed;
      if (written === 0) {
        reportZipIssue("stream-empty", new Error("no photos fetched"), { ...opts.context, mode: "stream", bytes: sp.bytes, done: sp.done, total });
        return { ok: false, error: "None of the photos could be downloaded.", written, failed: sp.failed };
      }
      return { ok: true, written, failed: sp.failed, bytes: sp.bytes, parts: 1 };
    } catch (e) {
      // Oct 30: the Save-dialog file can fail on some PCs (OneDrive-synced
      // folders, managed PCs, "file too large", quota, NotAllowed) — Kyle Blom.
      // Discard the half-written file and redo the whole zip as plain
      // downloads (parts mode), the way single photos already save fine.
      reportZipIssue("stream-write", e, { ...opts.context, mode: "stream→parts", bytes: sp.bytes, done: sp.done, total });
      abandoned = true;
      // abort() discards what was written (Chrome writes to a .crswap file
      // and only replaces the picked file on close). The picked file is not
      // removed: it may be an existing file the user chose to overwrite.
      try { await target.writable.abort(); } catch { /* already closed */ }
      progress = { done: 0, total, failed: 0, bytes: 0 };
      report();
      // falls through to parts mode below
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
    const files = async function* (): AsyncGenerator<StoredFile> {
      for (const e of group) {
        const data = await fetchBytes(e.url);
        if (!data) {
          progress.failed++;
          progress.done++;
          report();
          continue;
        }
        yield { name: e.name, data, lastModified: new Date() };
        progress.bytes += data.byteLength;
        progress.done++;
        groupWritten++;
        report();
      }
    };

    try {
      const zip = await new Response(writeStoredZip(files())).blob();
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
      reportZipIssue("parts", e, { ...opts.context, mode: "parts", bytes: progress.bytes, done: progress.done, total });
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
  if (written === 0) {
    reportZipIssue("parts-empty", new Error("no photos fetched"), { ...opts.context, mode: "parts", bytes: progress.bytes, done: progress.done, total });
    return { ok: false, error: "None of the photos could be downloaded.", written, failed: progress.failed };
  }
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

// ── Save to a folder (Oct 30) ─────────────────────────────────────────────
// Chrome holds script-started downloads after the first for confirmation
// (every "separate file" ended as .crdownload on Charlie's PC), and scans
// zips (Kyle Blom's "file too large"). Writing straight into a folder the
// user picks (File System Access API, Chrome / Edge on a computer) avoids
// Chrome's download pipeline altogether. Elsewhere: the zip.

type DirHandle = {
  name: string;
  getDirectoryHandle: (name: string, o?: { create?: boolean }) => Promise<DirHandle>;
  getFileHandle: (name: string, o?: { create?: boolean }) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;
  removeEntry: (name: string) => Promise<void>;
};
type DirPickerWindow = Window & { showDirectoryPicker?: (o?: unknown) => Promise<DirHandle> };

/** "Save to a folder" works here: Chrome / Edge on a computer (not phones, not embedded browsers). */
export function folderSaveSupported(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as DirPickerWindow).showDirectoryPicker === "function" && !isTouchDevice() && !isEmbeddedWebView();
}

/** Characters a Windows / macOS file name can't have; no trailing dots / spaces. */
function safeFileName(n: string): string {
  return n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "") || "photo";
}

export type FolderTarget =
  | { kind: "folder"; dir: DirHandle; path: string }
  | { kind: "cancelled" }
  /** The picker or the subfolder failed — use the zip instead. */
  | { kind: "unsupported" };

/**
 * Ask for a folder (call FIRST in the click handler — the picker needs the
 * click's user activation), then make "<subfolder>" inside it, or
 * "<subfolder> (2)" … if that name is taken.
 */
export async function openFolderTarget(subfolder: string, ctx: ZipContext = {}): Promise<FolderTarget> {
  const w = window as DirPickerWindow;
  if (!folderSaveSupported() || !w.showDirectoryPicker) return { kind: "unsupported" };
  let step = "dirPicker";
  try {
    const parent = await w.showDirectoryPicker({ mode: "readwrite", startIn: "downloads", id: "yp-photos" });
    step = "subfolder";
    const base = safeFileName(subfolder);
    let name = base;
    for (let n = 2; n < 100; n++) {
      try {
        await parent.getDirectoryHandle(name, { create: false });
        name = `${base} (${n})`; // taken
      } catch {
        break; // free
      }
    }
    const dir = await parent.getDirectoryHandle(name, { create: true });
    return { kind: "folder", dir, path: `${parent.name}/${dir.name}` };
  } catch (e) {
    if (step === "dirPicker" && e instanceof DOMException && e.name === "AbortError") return { kind: "cancelled" };
    reportZipIssue(step, e, { ...ctx, mode: "folder→zip" });
    return { kind: "unsupported" };
  }
}

export type FolderProgress = { done: number; total: number; failed: number; bytes: number };
export type FolderResult = {
  written: number; failed: number; bytes: number; cancelled: boolean;
  /** Writing failed before any photo was saved — use the zip instead. */
  fallback: boolean;
};

/**
 * Write every photo into the folder: fetched two at a time and streamed
 * straight into its file (no whole-file Blob). Each photo is tried three
 * times; one that still fails is skipped, counted and removed. Cancel with
 * the AbortSignal (the file being written is removed). `name` is the file
 * name inside the folder ("01 Salon.jpg").
 */
export async function saveToFolder(
  target: Extract<FolderTarget, { kind: "folder" }>,
  entries: { name: string; url: string | null | undefined }[],
  opts: { onProgress?: (p: FolderProgress) => void; signal?: AbortSignal; context?: ZipContext } = {}
): Promise<FolderResult> {
  const { dir } = target;
  const p: FolderProgress = { done: 0, total: entries.length, failed: 0, bytes: 0 };
  const report = () => opts.onProgress?.({ ...p });
  report();
  let written = 0;
  let fallback = false;
  let next = 0;
  const used = new Set<string>();
  const names = entries.map((e) => {
    let n = safeFileName(e.name.split("/").pop() || e.name);
    if (used.has(n.toLowerCase())) {
      const dot = n.lastIndexOf(".");
      const [stem, ext] = dot > 0 ? [n.slice(0, dot), n.slice(dot)] : [n, ""];
      let k = 2;
      while (used.has(`${stem} (${k})${ext}`.toLowerCase())) k++;
      n = `${stem} (${k})${ext}`;
    }
    used.add(n.toLowerCase());
    return n;
  });

  async function writeOne(i: number): Promise<void> {
    const e = entries[i];
    const name = names[i];
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (opts.signal?.aborted || fallback) return;
      if (attempt > 0) await sleep(800 * attempt);
      let counted = 0;
      let writeStep = false;
      try {
        if (!e.url) throw new Error("no link");
        const res = await fetchWithRetry(e.url, opts.signal ? { signal: opts.signal } : undefined);
        if (!res.body) throw new Error("empty response");
        writeStep = true;
        const fh = await dir.getFileHandle(name, { create: true });
        const writable = await fh.createWritable();
        await res.body
          .pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, ctl) {
              counted += chunk.byteLength;
              p.bytes += chunk.byteLength;
              ctl.enqueue(chunk);
            },
          }))
          .pipeTo(writable, opts.signal ? { signal: opts.signal } : undefined);
        written++;
        p.done++;
        report();
        return;
      } catch (err) {
        p.bytes -= counted;
        lastErr = err;
        if (writeStep) await dir.removeEntry(name).catch(() => {});
        if (opts.signal?.aborted) return;
        // The folder itself can't be written (blocked / no permission):
        // nothing saved yet → stop and let the caller use the zip.
        if (writeStep && written === 0 && !(err instanceof TypeError)) {
          if (fallback) return; // the other worker already reported it
          fallback = true;
          reportZipIssue("folder-write", err, { ...opts.context, mode: "folder→zip", bytes: p.bytes, done: p.done, total: p.total });
          return;
        }
      }
    }
    p.failed++;
    p.done++;
    report();
    reportZipIssue("folder", lastErr, { ...opts.context, mode: "folder", bytes: p.bytes, done: p.done, total: p.total });
  }

  const worker = async () => {
    while (!opts.signal?.aborted && !fallback && next < entries.length) {
      const i = next++;
      await writeOne(i);
    }
  };
  await Promise.all([worker(), worker()]);
  return { written, failed: p.failed, bytes: p.bytes, cancelled: !!opts.signal?.aborted, fallback };
}

/** "1.2 GB" / "340 MB" for progress text. */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(0, Math.round(n / 1e3))} KB`;
}
