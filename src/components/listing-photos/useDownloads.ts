"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SHARE_BATCH, shouldUseShareSheet, isTouchDevice, photoFileName, fetchPhotoFiles,
  sharePhotoFiles, saveFilesSequentially, saveFilesAsZip,
} from "@/lib/photoSave";
import type { ListingPhoto, OnPhotoMessage } from "./types";
import { signOriginalsInBrowser } from "@/lib/photoStoreClient";
import {
  formatBytes, openZipTarget, partLimitBytes, folderSaveAvailable, openFolderTarget, reportZipIssue, saveToFolder, writeZip,
  plainDownloadsPreferred, setPlainDownloads, choosePlainDownloads, type ZipEntry, type ZipTarget,
  startDownloadTrace, traceDownload, traceErrorText, pickerBlurred, type DownloadTrace, type TraceOutcome,
} from "@/lib/zipDownload";
import { PICKER_HINT, PICKER_REPEAT, ZIP_INSTEAD_LABEL } from "./DownloadNotice";
import { createClient } from "@/lib/supabase/client";
import { fullSizeNote, signPhotosForDownload, type SignedDownloads } from "./signDownloads";

// Two ways photos leave a listing page, one per role:
//
//  • useSizedDownloads — broker page. Size menu (Full / Web & MLS / Social),
//    links signed by /api/listings/[id]/photos/download-urls at download
//    time, zip for several, every download logged for the broker.
//    The admin page uses it too (logDownloads: false, own remembered size).
//  • useOriginalSave — admin page "Save originals". Full-size originals for
//    Charlie's own copy (no licence, no download log); on a phone they go to
//    the share sheet.

/** Download sizes offered to brokers. Resized ones are Supabase transforms
 *  signed by /api/listings/[id]/photos/download-urls (long edge capped). */
export type DownloadSize = "full" | "web" | "social";
export const DOWNLOAD_SIZES: { value: DownloadSize; label: string; short: string; suffix: string }[] = [
  { value: "web", label: "Web & MLS (2048px)", short: "Web & MLS", suffix: "2048px" },
  { value: "social", label: "Social (1080px)", short: "Social", suffix: "1080px" },
  { value: "full", label: "Full resolution (print)", short: "Full resolution", suffix: "" },
];

/** How a traced bulk download ended (filled in as it goes; sent in `finally`). */
type TraceEnd = { outcome: TraceOutcome; data: Record<string, unknown> };

/** fetch → blob, retrying a 429 / 5xx twice with a short back-off. */
async function fetchBlobWithRetry(url: string): Promise<Blob> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.blob();
    if (attempt >= 2 || !(res.status === 429 || res.status >= 500)) {
      throw new Error(`HTTP ${res.status}`);
    }
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1) + Math.random() * 400));
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Broker page downloads — see the note at the top of this file. */
export function useSizedDownloads(opts: {
  listingId: string;
  vesselName: string | null;
  onMessage: OnPhotoMessage;
  /** After a successful download (the page leaves select mode). */
  onFinished: () => void;
  /** Record each download in photo_downloads (the listing's Download
   *  Activity). Default true; the admin page passes false — the table has no
   *  role column, so an admin's download would read as a broker's. */
  logDownloads?: boolean;
  /** localStorage key for the remembered size (admin keeps its own). */
  sizeStorageKey?: string;
  /** A download the user started (not a follow-on) — the page clears a stale notice. */
  onStart?: () => void;
}) {
  const { listingId, vesselName, onMessage, onFinished, logDownloads = true, sizeStorageKey = "yp_download_size", onStart } = opts;
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  /** What the zip is doing, e.g. "12 of 194 photos · 480 MB" (null when idle). */
  const [downloadLabel, setDownloadLabel] = useState<string | null>(null);
  /** "Save to a folder" running — it can be cancelled. */
  const [savingToFolder, setSavingToFolder] = useState(false);
  /** This browser has "Save to a folder" (Chrome / Edge on a computer) — known after mount. */
  const [folderAvailable, setFolderAvailable] = useState(false);
  /** Nov 11: this browser is switched to plain downloads (localStorage
   *  "yp_plain_downloads" — a locked-down PC blocked the Save / folder
   *  window, or the user chose "Download as a zip instead"): no windows,
   *  Download All goes straight to ordinary zip downloads. */
  const [plain, setPlain] = useState(false);
  const syncPlain = () => setPlain(plainDownloadsPreferred());
  useEffect(() => { setFolderAvailable(folderSaveAvailable()); syncPlain(); }, []);
  const canFolder = folderAvailable && !plain;
  /** A download is running (read by the banner's "Download as a zip instead", whose closure is older). */
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = downloading; }, [downloading]);
  const abortRef = useRef<AbortController | null>(null);
  /** The photos of a zip that just failed — offered "Save to a folder instead". */
  const [zipFailed, setZipFailed] = useState<ListingPhoto[] | null>(null);
  // Download size for every download button on the page (remembered per browser).
  const [downloadSize, setDownloadSizeState] = useState<DownloadSize>("web"); // Web & MLS by default (Oct 29): fast, and what most downloads are for
  function setDownloadSize(v: DownloadSize) {
    setDownloadSizeState(v);
    try { localStorage.setItem(sizeStorageKey, v); } catch { /* private mode */ }
  }
  useEffect(() => {
    try {
      const v = localStorage.getItem(sizeStorageKey);
      if (v === "full" || v === "web" || v === "social") setDownloadSizeState(v);
    } catch { /* private mode */ }
  }, [sizeStorageKey]);

  function logDownload(photoCount: number) {
    if (!logDownloads) return;
    fetch(`/api/listings/${listingId}/log-download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoCount }),
    }).catch(() => {});
  }

  /** Tooltip for the per-photo download button — names the chosen size. */
  const downloadTitle = downloadSize === "full"
    ? "Download photo"
    : `Download photo (${DOWNLOAD_SIZES.find((o) => o.value === downloadSize)?.label})`;

  const extOf = (p: ListingPhoto) => (p.filename?.split(".").pop() ?? "jpg").toLowerCase();

  /**
   * Fresh download links for these photos at the chosen size, signed by the
   * server at download time (re-checks access; never reuses page-load links,
   * which expire). Full resolution are the originals; the others are resized
   * by Supabase when fetched — or, for originals on R2, pre-made files the
   * server may still be making (`pending`: asked again, a few times).
   * `ext` = the extension of a pre-made file (jpg / png). Photos whose sized
   * copy couldn't be had come down as originals (`original`) — see
   * ./signDownloads.ts, shared with the My Listings row.
   */
  function signForDownload(targets: ListingPhoto[], size: DownloadSize): Promise<SignedDownloads> {
    return signPhotosForDownload(listingId, targets, size, createClient());
  }

  /**
   * The Save / folder window came back "cancelled". It may really have been
   * blocked (a managed work PC answers exactly like Cancel), so never end in
   * silence: say nothing was saved and offer the plain zip — ordinary browser
   * downloads, no window. Choosing it is reported and remembered.
   */
  function pickerCancelled(targets: ListingPhoto[], mode: "folder" | "zip", ms: number, trace: DownloadTrace, repeat = false) {
    const size = downloadSize;
    // Second cancel in a row in this tab (src/lib/zipDownload.ts): say it firmly.
    if (repeat) trace.send("picker-repeat-cancel", { picker: mode, ms });
    trace.send("hint-shown", { picker: mode, repeat });
    const copy = repeat ? PICKER_REPEAT : PICKER_HINT;
    onMessage({
      kind: "info",
      title: copy.title,
      text: copy.body,
      dismissLabel: "Not now",
      action: {
        label: ZIP_INSTEAD_LABEL,
        run: () => {
          if (trace.attempt) traceDownload("hint-clicked", { attempt: trace.attempt, listingId, size, count: targets.length, picker: mode });
          if (busyRef.current) return;
          choosePlainDownloads({ listingId, size, mode, ms, total: targets.length });
          syncPlain();
          void downloadPhotos(targets, { plain: true, via: "hint-zip", parent: trace.attempt });
        },
      },
    });
  }

  /** Nothing could be signed at all: say so (never a silent finish) and log it. */
  function signedNothing(count: number, size: DownloadSize) {
    reportZipIssue("sign-empty", new Error("no download links"), { listingId, size, total: count });
    onMessage({ kind: "error", title: "The photos couldn't be downloaded.", text: "Nothing was saved. Please try again in a moment." });
  }

  /** Total bytes of these photos at each size (no links signed); null if unknown. */
  async function estimateSizes(targets: ListingPhoto[]): Promise<{ full: number; web: number; social: number } | null> {
    try {
      const res = await fetch(`/api/listings/${listingId}/photos/download-urls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: targets.map((t) => t.id), size: "full", estimate: true }),
      });
      if (!res.ok) return null;
      const d = await res.json().catch(() => null);
      return d?.totals ?? null;
    } catch {
      return null;
    }
  }

  /** Names and extensions shared by every download path. */
  const cleanName = (t: string) => t.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const extWith = (madeExt: Record<string, string>) => (p: ListingPhoto) => {
    // A pre-made R2 file is JPEG (or PNG): name it so; otherwise the original's extension.
    const made = madeExt[p.id];
    if (!made) return extOf(p);
    return made === "jpg" && extOf(p) === "jpeg" ? "jpeg" : made;
  };

  /**
   * "Save to a folder" (Oct 30) — Chrome / Edge on a computer: the broker
   * picks a folder once and the photos are written straight into a new
   * "<Vessel> – Web & MLS" folder inside it (src/lib/zipDownload.ts
   * saveToFolder), at the chosen size, named "01 Salon.jpg" in listing order.
   * No zip and no Chrome download queue — for office computers that block
   * zips. Call it straight from the click (the folder picker needs it).
   * If the folder can't be used, it falls back to the zip.
   */
  async function saveToFolderAction(targets: ListingPhoto[], via = "download-all") {
    if (targets.length === 0 || downloading) return;
    onStart?.();
    // Nov 11 bulk-download trace (src/lib/zipDownload.ts): `end` sent once, whatever happens.
    const trace = startDownloadTrace({ via, listingId, size: downloadSize, count: targets.length, canFolder });
    const end: TraceEnd = { outcome: "error", data: { mode: "folder" } };
    try {
      await saveToFolderSteps(targets, trace, end);
    } catch (e) {
      end.outcome = "error";
      end.data.error = traceErrorText(e);
      throw e;
    } finally {
      trace.end(end.outcome, end.data);
    }
  }

  async function saveToFolderSteps(targets: ListingPhoto[], trace: DownloadTrace, end: TraceEnd) {
    const size = downloadSize;
    const sizeInfo = DOWNLOAD_SIZES.find((s) => s.value === size) ?? DOWNLOAD_SIZES[0];
    const vessel = vesselName ? cleanName(vesselName) : "";
    const p0 = trace.ms();
    const folder = await openFolderTarget(`${vessel || "Photos"} – ${sizeInfo.short}`, { listingId, size });
    trace.send("picker", {
      picker: "folder", kind: folder.kind, blocked: folder.kind === "unsupported" && !!folder.blocked,
      ms: folder.kind === "cancelled" ? folder.ms : trace.ms() - p0, blurred: pickerBlurred(),
    });
    if (folder.kind === "cancelled") {
      end.outcome = "cancelled";
      pickerCancelled(targets, "folder", folder.ms, trace, !!folder.repeat);
      return;
    }
    if (folder.kind === "unsupported") {
      // Blocked (managed PC): plain zip downloads, no Save window — and from now on.
      syncPlain();
      trace.end("fallback", { mode: "folder" });
      await downloadPhotos(targets, { plain: !!folder.blocked, via: "folder-fallback", parent: trace.attempt });
      return;
    }
    setZipFailed(null);
    setDownloading(true);
    setSavingToFolder(true);
    setDownloadProgress(0);
    setDownloadLabel("Preparing…");
    const ctl = new AbortController();
    abortRef.current = ctl;
    const s0 = trace.ms();
    const { urls, ext, original } = await signForDownload(targets, size);
    trace.send("signed", { urls: Object.keys(urls).length, original: original.length, ms: trace.ms() - s0 });
    if (Object.keys(urls).length === 0) {
      end.outcome = "none";
      abortRef.current = null;
      setDownloading(false);
      setSavingToFolder(false);
      setDownloadProgress(0);
      setDownloadLabel(null);
      signedNothing(targets.length, size);
      return;
    }
    const extFor = extWith(ext);
    const fullNote = fullSizeNote(targets.filter((t) => original.indexOf(t.id) >= 0).length);
    const pad = Math.max(2, String(targets.length).length);
    const entries = targets.map((photo, i) => {
      const label = cleanName(photo.category ?? "Photo") || "Photo";
      return { name: `${String(i + 1).padStart(pad, "0")} ${label}.${extFor(photo)}`, url: urls[photo.id] };
    });
    const result = await saveToFolder(folder, entries, {
      signal: ctl.signal,
      context: { listingId, size },
      onProgress: (p) => {
        trace.progress(p.done - p.failed, p.bytes);
        setDownloadProgress(p.total ? Math.round((p.done / p.total) * 100) : 0);
        setDownloadLabel(`${p.done} of ${p.total} photos`);
      },
    });
    abortRef.current = null;
    setDownloading(false);
    setSavingToFolder(false);
    setDownloadProgress(0);
    setDownloadLabel(null);
    end.data = { mode: "folder", written: result.written, failed: result.failed, bytes: result.bytes };
    end.outcome = result.fallback ? "fallback" : result.cancelled ? "cancelled" : result.written === 0 ? "none" : result.failed > 0 ? "partial" : "saved";
    if (result.fallback) {
      // Nothing was written (blocked folder): the zip as plain downloads, no Save window.
      syncPlain();
      onMessage({ kind: "info", text: "That folder couldn't be written to — downloading a zip instead.", ms: 8000 });
      trace.end(end.outcome, end.data);
      await downloadPhotos(targets, { plain: true, via: "folder-fallback", parent: trace.attempt });
      return;
    }
    if (result.written > 0) logDownload(result.written);
    if (result.cancelled) {
      onMessage({ kind: "success", text: `Stopped — ${result.written} of ${targets.length} photos saved to ${folder.path}.`, ms: 8000 });
      return;
    }
    onFinished();
    if (result.written === 0) {
      onMessage({ kind: "error", title: "The photos couldn't be downloaded.", text: "Nothing was saved. Please try again in a moment." });
    } else if (result.failed > 0) {
      onMessage({ kind: "error", title: `${result.failed} photo${result.failed !== 1 ? "s" : ""} didn't download.`, text: `Saved ${result.written} photos to ${folder.path}. ${result.failed} couldn't be downloaded; try ${result.failed !== 1 ? "them" : "it"} again on ${result.failed !== 1 ? "their" : "its"} own.` });
    } else {
      onMessage({ kind: "success", text: `Saved ${result.written} photo${result.written !== 1 ? "s" : ""} to ${folder.path} (${formatBytes(result.bytes)}).${fullNote ? ` ${fullNote}` : ""}`, ms: fullNote ? 10000 : 8000 });
    }
  }

  /** Stop "Save to a folder" (photos already saved stay saved). */
  function cancelDownload() {
    abortRef.current?.abort();
  }

  /**
   * One photo: the file. Several: a zip — into the file picked in the Save
   * window (Chrome / Edge), or as ordinary downloads in ≤ 400 MB parts
   * (other browsers, `opts.plain`, or a browser switched to plain downloads).
   */
  async function downloadPhotos(targets: ListingPhoto[], opts: { plain?: boolean; via?: string; parent?: string } = {}) {
    if (targets.length === 0) return;
    if (!opts.parent) onStart?.();
    // Nov 11 bulk-download trace (none for one photo): `end` sent once, whatever happens.
    const trace = startDownloadTrace({
      via: opts.via ?? (canFolder ? "zip-link" : "download-all"),
      listingId, size: downloadSize, count: targets.length, canFolder, parent: opts.parent,
    });
    const end: TraceEnd = { outcome: "error", data: {} };
    try {
      await downloadPhotosSteps(targets, opts, trace, end);
    } catch (e) {
      end.outcome = "error";
      end.data.error = traceErrorText(e);
      throw e;
    } finally {
      trace.end(end.outcome, end.data);
    }
  }

  async function downloadPhotosSteps(targets: ListingPhoto[], opts: { plain?: boolean }, trace: DownloadTrace, end: TraceEnd) {
    setZipFailed(null);
    setDownloading(true);
    setDownloadProgress(0);

    const size = downloadSize;
    const sizeInfo = DOWNLOAD_SIZES.find((s) => s.value === size) ?? DOWNLOAD_SIZES[0];
    const vessel = vesselName ? cleanName(vesselName) : "";

    // Several photos: open the Save dialog NOW, while the click still counts
    // as a user gesture (it can't be opened after the links are signed).
    let zipTarget: ZipTarget | null = null;
    if (targets.length > 1) {
      const zipName = `${vesselName ? cleanName(vesselName) : "photos"}-photos${sizeInfo.suffix ? `-${sizeInfo.suffix}` : ""}.zip`;
      const p0 = trace.ms();
      zipTarget = await openZipTarget(zipName, { listingId, size }, { plain: !!opts.plain });
      trace.send("picker", {
        picker: "zip", kind: zipTarget.kind, blocked: zipTarget.kind === "parts" && !!zipTarget.blocked,
        ms: zipTarget.kind === "cancelled" ? zipTarget.ms : trace.ms() - p0, blurred: pickerBlurred(),
      });
      end.data.mode = zipTarget.kind === "cancelled" ? null : zipTarget.kind;
      if (zipTarget.kind === "cancelled") {
        end.outcome = "cancelled";
        setDownloading(false);
        setDownloadProgress(0);
        pickerCancelled(targets, "zip", zipTarget.ms, trace, !!zipTarget.repeat);
        return;
      }
      if (zipTarget.kind === "parts" && zipTarget.blocked) syncPlain();
      setDownloadLabel("Preparing…");

      // Full resolution as plain downloads (Safari, iPhone, Firefox, or a
      // PC whose Save window is blocked) goes out as several zips — say so
      // first, with the Web & MLS size beside it, when it's more than ~500 MB.
      if (zipTarget.kind === "parts" && size === "full") {
        const est = await estimateSizes(targets);
        if (est && est.full > 500 * 1024 * 1024) {
          const zips = Math.max(2, Math.ceil(est.full / partLimitBytes()));
          const go = window.confirm(
            `Full resolution is ${formatBytes(est.full)} — it'll save as about ${zips} zips in your Downloads folder. Web & MLS is ${formatBytes(est.web)}.\n\nOK to continue at full resolution, or Cancel and pick Web & MLS from the size menu.`
          );
          if (!go) {
            end.outcome = "cancelled";
            setDownloading(false);
            setDownloadProgress(0);
            setDownloadLabel(null);
            return;
          }
        }
      }
    }

    const s0 = trace.ms();
    const { urls: fresh, ext: madeExt, bytes: madeBytes, original } = await signForDownload(targets, size);
    trace.send("signed", { urls: Object.keys(fresh).length, original: original.length, ms: trace.ms() - s0 });
    const extFor = extWith(madeExt);
    if (Object.keys(fresh).length === 0) {
      end.outcome = "none";
      if (zipTarget?.kind === "stream") await zipTarget.writable.abort().catch(() => {});
      setDownloading(false);
      setDownloadProgress(0);
      setDownloadLabel(null);
      signedNothing(targets.length, size);
      return;
    }
    const fullNote = fullSizeNote(targets.filter((t) => original.indexOf(t.id) >= 0).length);

    // Single photo — direct download, no ZIP needed
    if (targets.length === 1) {
      const photo = targets[0];
      try {
        const url = fresh[photo.id];
        if (!url) throw new Error("no link");
        const blob = await fetchBlobWithRetry(url);
        const ext = extFor(photo);
        // "Sea Dream – Salon.jpg": the vessel name keeps a loose download
        // identifiable in a Downloads folder full of "Salon.jpg"s. Resized
        // copies say their size so they can't be mistaken for the original.
        const label = cleanName(photo.category ?? "Photo") || "Photo";
        // Served as the original (its sized copy couldn't be made): no size in the name.
        const suffix = original.indexOf(photo.id) >= 0 ? "" : sizeInfo.suffix;
        const filename = `${vessel ? `${vessel} – ` : ""}${label}${suffix ? ` (${suffix})` : ""}.${ext}`;
        triggerDownload(blob, filename);
        // Log download silently (fire-and-forget)
        logDownload(1);
        onFinished();
      } catch {
        onMessage({ kind: "error", title: "That photo couldn't be downloaded.", text: "Please try again in a moment." });
      }
      setDownloading(false);
      setDownloadProgress(0);
      return;
    }

    // Multiple photos — a STREAMING zip (src/lib/zipDownload.ts), all inside
    // a "{Vessel}/" folder, named "{nn} {Category}.jpg" so they sort in
    // listing order. Store mode. Chrome / Edge write straight into the file
    // picked (any size); other browsers get ≤ 1 GB parts.
    const folder = vessel || "Photos";
    const pad = Math.max(2, String(targets.length).length);
    const baseName = `${vesselName ? cleanName(vesselName) : "photos"}-photos${sizeInfo.suffix ? `-${sizeInfo.suffix}` : ""}`;
    const entries: ZipEntry[] = targets.map((photo, index) => {
      const label = cleanName(photo.category ?? "Photo") || "Photo";
      return { name: `${folder}/${String(index + 1).padStart(pad, "0")} ${label}.${extFor(photo)}`, url: fresh[photo.id], size: madeBytes[photo.id] ?? null };
    });
    const result = await writeZip(zipTarget as Exclude<ZipTarget, { kind: "cancelled" }>, entries, {
      baseName,
      context: { listingId, size },
      onProgress: (p) => {
        trace.progress(p.done - p.failed, p.bytes);
        setDownloadProgress(p.total ? Math.round((p.done / p.total) * 100) : 0);
        setDownloadLabel(
          `${p.parts && p.parts > 1 ? `Part ${p.part} of ${p.parts} · ` : ""}${p.done} of ${p.total} photos · ${formatBytes(p.bytes)}`
        );
      },
    });
    end.data = result.ok
      ? { mode: result.fellBack ? "parts" : zipTarget?.kind, written: result.written, failed: result.failed, bytes: result.bytes, zips: result.parts }
      : { mode: zipTarget?.kind, written: result.written, failed: result.failed, error: result.error };
    end.outcome = result.written === 0 ? "none" : result.ok && result.failed === 0 ? "saved" : "partial";
    setDownloading(false);
    setDownloadProgress(0);
    setDownloadLabel(null);
    if (result.ok && result.fellBack) syncPlain();
    if (!result.ok) {
      setZipFailed(targets);
      onMessage({ kind: "error", title: "The download didn't finish.", text: canFolder ? `${result.error} Or use Save to a folder.` : result.error });
      return;
    }
    logDownload(result.written);
    onFinished();
    if (result.failed > 0) {
      onMessage({
        kind: "error",
        title: `${result.failed} photo${result.failed !== 1 ? "s" : ""} didn't download.`,
        text: `Saved ${result.written} photos${result.parts > 1 ? ` in ${result.parts} zip files` : ""}. ${result.failed} couldn't be downloaded — download ${result.failed !== 1 ? "them" : "it"} again on ${result.failed !== 1 ? "their" : "its"} own.`,
      });
    } else {
      // Plain downloads: name the zip files and where they went.
      const asParts = zipTarget?.kind === "parts" || !!result.fellBack;
      const where = asParts
        ? ` in ${result.parts} zip file${result.parts !== 1 ? "s" : ""} — in your Downloads folder${result.parts > 1 ? " (if the browser asked to allow multiple downloads, choose Allow)" : ""}`
        : "";
      onMessage({
        kind: "success",
        text: `Saved ${result.written} photos (${formatBytes(result.bytes)})${where}.${fullNote ? ` ${fullNote}` : ""}`,
        ms: fullNote || asParts ? 10000 : 5000,
      });
    }
  }

  /** Back to the Save / folder windows after plain downloads were remembered. */
  function restoreFolder() {
    setPlainDownloads(false);
    syncPlain();
    onMessage({ kind: "info", text: "Download All will ask for a folder again.", ms: 5000 });
  }

  return {
    downloading, downloadProgress, downloadLabel, downloadSize, setDownloadSize, downloadTitle, downloadPhotos,
    /** "Save to a folder" — null where the browser can't (Safari, Firefox, phones). */
    saveToFolder: canFolder ? saveToFolderAction : null,
    savingToFolder, cancelDownload,
    /** After a failed zip: the same photos to a folder (null when nothing failed / unsupported). */
    retryToFolder: zipFailed && canFolder ? () => saveToFolderAction(zipFailed, "retry-folder") : null,
    /** Plain downloads are remembered here but the browser can save to a
     *  folder: "Save straight to a folder instead" (null otherwise). */
    restoreFolder: folderAvailable && plain ? restoreFolder : null,
  };
}

export type SizedDownloads = ReturnType<typeof useSizedDownloads>;

/**
 * Admin page: saving full-resolution originals (phone or desktop).
 *
 * Same files brokers download (the listing-photos originals), signed fresh at
 * the moment of saving so a page left open for hours still works. No licence
 * modal and no broker download log — this is the admin's own copy.
 * Phone: photos are fetched, then a button opens the share sheet ("Save
 * image" / Instagram / Facebook) — iOS needs a fresh tap for that, so the
 * fetch can't happen inside the same tap. Up to SHARE_BATCH per sheet.
 * Desktop: one photo → the file; several → a zip.
 */
export function useOriginalSave(opts: {
  supabase: SupabaseClient;
  vesselName: string | null;
  photos: ListingPhoto[];
  onMessage: OnPhotoMessage;
  /** After a successful save (the page leaves select mode). */
  onFinished: () => void;
  /** A save the user started (not a follow-on) — the page clears a stale notice. */
  onStart?: () => void;
}) {
  const { supabase, vesselName, photos, onMessage, onFinished, onStart } = opts;
  const [saveBusy, setSaveBusy] = useState<{ done: number; total: number; zipping?: boolean } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shareJob, setShareJob] = useState<{ targets: ListingPhoto[]; start: number; files: File[]; failed: number } | null>(null);
  const saveLocked = saveBusy !== null || shareJob !== null;

  async function saveItems(targets: ListingPhoto[]): Promise<{ url: string; name: string }[]> {
    let fresh = new Map<string, string>();
    try {
      // Supabase or R2, per photo (src/lib/photoStoreClient.ts).
      fresh = await signOriginalsInBrowser(supabase, targets.map((t) => t.storage_path), 900);
    } catch { /* fall back to the urls the page was given */ }
    const out: { url: string; name: string }[] = [];
    targets.forEach((t) => {
      const url = fresh.get(t.storage_path) ?? t.url;
      if (url) out.push({ url, name: photoFileName(vesselName, photos.indexOf(t), t) });
    });
    return out;
  }

  async function prepareShareBatch(targets: ListingPhoto[], start: number) {
    const batch = targets.slice(start, start + SHARE_BATCH);
    setShareJob(null);
    setSaveError(null);
    setSaveBusy({ done: 0, total: batch.length });
    try {
      const items = await saveItems(batch);
      const { files, failed } = await fetchPhotoFiles(items, (done, total) => setSaveBusy({ done, total }));
      if (files.length === 0) {
        setSaveError("Couldn't get the photos. Check your connection and try again.");
        return;
      }
      setShareJob({ targets, start, files, failed: failed + (batch.length - items.length) });
    } catch {
      setSaveError("Couldn't get the photos. Check your connection and try again.");
    } finally {
      setSaveBusy(null);
    }
  }

  async function savePhotos(targets: ListingPhoto[], via = "originals", parent?: string) {
    if (targets.length === 0 || saveLocked) return;
    setSaveError(null);
    if (!parent) onStart?.();
    if (shouldUseShareSheet()) {
      await prepareShareBatch(targets, 0);
      return;
    }
    // Nov 11 bulk-download trace (computers only; none for one photo): `end` sent once.
    const trace = startDownloadTrace({ via, count: targets.length, canFolder: false, parent });
    const end: TraceEnd = { outcome: "error", data: {} };
    try {
      await savePhotosSteps(targets, trace, end);
    } catch (e) {
      end.outcome = "error";
      end.data.error = traceErrorText(e);
      throw e;
    } finally {
      trace.end(end.outcome, end.data);
    }
  }

  async function savePhotosSteps(targets: ListingPhoto[], trace: DownloadTrace, end: TraceEnd) {
    // Several photos on a desktop: a streaming zip (src/lib/zipDownload.ts) —
    // full-resolution shoots are several GB, far more than fits in memory.
    // The Save dialog is opened first, while the click still counts.
    if (targets.length > 1 && !isTouchDevice()) {
      const base = (vesselName ?? "photos").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "photos";
      const p0 = trace.ms();
      const target = await openZipTarget(`${base}-photos.zip`);
      trace.send("picker", {
        picker: "zip", kind: target.kind, blocked: target.kind === "parts" && !!target.blocked,
        ms: target.kind === "cancelled" ? target.ms : trace.ms() - p0, blurred: pickerBlurred(),
      });
      if (target.kind === "cancelled") {
        end.outcome = "cancelled";
        // May have been blocked, not cancelled: say so and offer the plain zip
        // (more firmly the second time in a row — src/lib/zipDownload.ts).
        const ms = target.ms;
        const repeat = !!target.repeat;
        if (repeat) trace.send("picker-repeat-cancel", { picker: "zip", ms });
        trace.send("hint-shown", { picker: "zip", repeat });
        const copy = repeat ? PICKER_REPEAT : PICKER_HINT;
        onMessage({
          kind: "info",
          title: copy.title,
          text: copy.body,
          dismissLabel: "Not now",
          action: {
            label: ZIP_INSTEAD_LABEL,
            run: () => {
              if (trace.attempt) traceDownload("hint-clicked", { attempt: trace.attempt, count: targets.length, picker: "zip" });
              choosePlainDownloads({ mode: "originals", ms, total: targets.length });
              void savePhotos(targets, "hint-zip", trace.attempt);
            },
          },
        });
        return;
      }
      end.data.mode = target.kind;
      setSaveBusy({ done: 0, total: targets.length });
      try {
        const s0 = trace.ms();
        const items = await saveItems(targets);
        trace.send("signed", { urls: items.length, original: items.length, ms: trace.ms() - s0 });
        const result = await writeZip(target, items.map((it) => ({ name: it.name, url: it.url })), {
          baseName: `${base}-photos`,
          onProgress: (p) => { trace.progress(p.done - p.failed, p.bytes); setSaveBusy({ done: p.done, total: p.total }); },
        });
        end.data = result.ok
          ? { mode: result.fellBack ? "parts" : target.kind, written: result.written, failed: result.failed, bytes: result.bytes, zips: result.parts }
          : { mode: target.kind, written: result.written, failed: result.failed, error: result.error };
        end.outcome = result.written === 0 ? "none" : result.ok && result.failed === 0 && items.length === targets.length ? "saved" : "partial";
        if (!result.ok) setSaveError(result.error);
        else {
          const missed = result.failed + (targets.length - items.length);
          if (missed > 0) setSaveError(`${missed} photo${missed !== 1 ? "s" : ""} couldn't be downloaded; the rest were saved.`);
          else onMessage({ kind: "success", text: `${result.written} photos saved${result.parts > 1 ? ` in ${result.parts} zip files` : ""}.`, ms: 4000 });
          onFinished();
        }
      } catch (e) {
        end.outcome = "error";
        end.data.error = traceErrorText(e);
        setSaveError("The download didn't finish. Please try again.");
      } finally {
        setSaveBusy(null);
      }
      return;
    }
    end.data.mode = "files";
    setSaveBusy({ done: 0, total: targets.length });
    try {
      const items = await saveItems(targets);
      const { files, failed } = await fetchPhotoFiles(items, (done, total) => setSaveBusy({ done, total }));
      if (files.length === 0) {
        end.outcome = "none";
        setSaveError("Couldn't get the photos. Check your connection and try again.");
        return;
      }
      end.outcome = files.length < targets.length ? "partial" : "saved";
      end.data.written = files.length;
      if (files.length === 1 || isTouchDevice()) {
        await saveFilesSequentially(files);
      } else {
        setSaveBusy({ done: files.length, total: files.length, zipping: true });
        const base = (vesselName ?? "photos").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "photos";
        await saveFilesAsZip(files, `${base}-photos.zip`);
      }
      const missed = failed + (targets.length - items.length);
      if (missed > 0) setSaveError(`${missed} photo${missed !== 1 ? "s" : ""} couldn't be downloaded; the rest were saved.`);
      else onMessage({ kind: "success", text: `${files.length} photo${files.length !== 1 ? "s" : ""} downloaded.`, ms: 3000 });
      onFinished();
    } catch (e) {
      end.outcome = "error";
      end.data.error = traceErrorText(e);
      setSaveError("The download didn't finish. Please try again.");
    } finally {
      setSaveBusy(null);
    }
  }

  // Runs straight from the button's click — nothing awaited before share().
  function shareReadyBatch() {
    if (!shareJob) return;
    const job = shareJob;
    sharePhotoFiles(job.files).then((result) => {
      if (result === "cancelled") return; // keep the batch; they can tap again
      if (result === "failed") {
        setSaveError("Your phone wouldn't open the share sheet. Try “Download instead”.");
        return;
      }
      const nextStart = job.start + SHARE_BATCH;
      if (nextStart < job.targets.length) {
        prepareShareBatch(job.targets, nextStart);
      } else {
        setShareJob(null);
        onFinished();
        onMessage({ kind: "success", text: "Photos sent to your phone.", ms: 3000 });
      }
    });
  }

  async function downloadReadyBatchInstead() {
    if (!shareJob) return;
    const job = shareJob;
    await saveFilesSequentially(job.files);
    const nextStart = job.start + SHARE_BATCH;
    if (nextStart < job.targets.length) prepareShareBatch(job.targets, nextStart);
    else setShareJob(null);
  }

  function closeSavePanel() {
    setShareJob(null);
    setSaveError(null);
  }

  return { saveBusy, saveError, shareJob, saveLocked, savePhotos, shareReadyBatch, downloadReadyBatchInstead, closeSavePanel };
}

export type OriginalSave = ReturnType<typeof useOriginalSave>;
