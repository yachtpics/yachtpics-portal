"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SHARE_BATCH, shouldUseShareSheet, isTouchDevice, photoFileName, fetchPhotoFiles,
  sharePhotoFiles, saveFilesSequentially, saveFilesAsZip,
} from "@/lib/photoSave";
import type { ListingPhoto, OnPhotoMessage } from "./types";
import { signOriginalsInBrowser } from "@/lib/photoStoreClient";
import { formatBytes, openZipTarget, partLimitBytes, saveFilesSeparately, usesZipParts, writeZip, type ZipEntry, type ZipTarget } from "@/lib/zipDownload";

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
}) {
  const { listingId, vesselName, onMessage, onFinished, logDownloads = true, sizeStorageKey = "yp_download_size" } = opts;
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  /** What the zip is doing, e.g. "12 of 194 photos · 480 MB" (null when idle). */
  const [downloadLabel, setDownloadLabel] = useState<string | null>(null);
  /** "Save as separate files" running — it can be cancelled. */
  const [savingSeparately, setSavingSeparately] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  /** The photos of a zip that just failed — offered as separate files. */
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
   * `ext` = the extension of a pre-made file (jpg / png).
   */
  async function signForDownload(targets: ListingPhoto[], size: DownloadSize): Promise<{ urls: Record<string, string>; ext: Record<string, string>; bytes: Record<string, number> }> {
    const urls: Record<string, string> = {};
    const ext: Record<string, string> = {};
    const bytes: Record<string, number> = {};
    let ask = targets.map((t) => t.id);
    for (let attempt = 0; ask.length > 0 && attempt < 6; attempt++) {
      let pending: string[] = [];
      try {
        const res = await fetch(`/api/listings/${listingId}/photos/download-urls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoIds: ask, size }),
        });
        if (!res.ok) break;
        const d = await res.json().catch(() => null);
        Object.assign(urls, (d?.urls ?? {}) as Record<string, string>);
        Object.assign(ext, (d?.ext ?? {}) as Record<string, string>);
        Object.assign(bytes, (d?.bytes ?? {}) as Record<string, number>);
        pending = Array.isArray(d?.pending) ? (d.pending as string[]) : [];
      } catch {
        break;
      }
      ask = pending;
    }
    return { urls, ext, bytes };
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
   * "Save as separate files" (Oct 30): every photo as its own download, no
   * zip — for office computers that block zip files. One photo at a time
   * (src/lib/zipDownload.ts saveFilesSeparately), at the chosen size, named
   * "Sea Dream – 01 Salon (2048px).jpg" so they sort in listing order.
   */
  async function saveSeparately(targets: ListingPhoto[]) {
    if (targets.length === 0 || downloading) return;
    setZipFailed(null);
    setDownloading(true);
    setSavingSeparately(true);
    setDownloadProgress(0);
    setDownloadLabel("Preparing…");
    const ctl = new AbortController();
    abortRef.current = ctl;
    const size = downloadSize;
    const sizeInfo = DOWNLOAD_SIZES.find((s) => s.value === size) ?? DOWNLOAD_SIZES[0];
    const vessel = vesselName ? cleanName(vesselName) : "";
    const { urls, ext } = await signForDownload(targets, size);
    const extFor = extWith(ext);
    const pad = Math.max(2, String(targets.length).length);
    const entries = targets.map((photo, i) => {
      const label = cleanName(photo.category ?? "Photo") || "Photo";
      const nn = targets.length > 1 ? `${String(i + 1).padStart(pad, "0")} ` : "";
      return {
        name: `${vessel ? `${vessel} – ` : ""}${nn}${label}${sizeInfo.suffix ? ` (${sizeInfo.suffix})` : ""}.${extFor(photo)}`,
        url: ctl.signal.aborted ? null : urls[photo.id],
      };
    });
    const result = await saveFilesSeparately(entries, {
      signal: ctl.signal,
      context: { listingId, size },
      onProgress: (p) => {
        setDownloadProgress(p.total ? Math.round((p.done / p.total) * 100) : 0);
        setDownloadLabel(`${p.done} of ${p.total} photos`);
      },
    });
    abortRef.current = null;
    setDownloading(false);
    setSavingSeparately(false);
    setDownloadProgress(0);
    setDownloadLabel(null);
    if (result.written > 0) logDownload(result.written);
    if (result.cancelled) {
      onMessage({ kind: "success", text: `Stopped — ${result.written} of ${targets.length} photos saved.`, ms: 6000 });
      return;
    }
    onFinished();
    if (result.written === 0) {
      onMessage({ kind: "error", text: "The photos couldn't be downloaded. Please try again in a moment.", ms: 10000 });
    } else if (result.failed > 0) {
      onMessage({ kind: "error", text: `Done — saved ${result.written} photos as separate files. ${result.failed} couldn't be downloaded; try ${result.failed !== 1 ? "them" : "it"} again on ${result.failed !== 1 ? "their" : "its"} own.`, ms: 10000 });
    } else {
      onMessage({ kind: "success", text: `Done — saved ${result.written} photo${result.written !== 1 ? "s" : ""} as separate files (${formatBytes(result.bytes)}).`, ms: 6000 });
    }
  }

  /** Stop "Save as separate files" (photos already saved stay saved). */
  function cancelDownload() {
    abortRef.current?.abort();
  }

  async function downloadPhotos(targets: ListingPhoto[]) {
    if (targets.length === 0) return;
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
      zipTarget = await openZipTarget(zipName, { listingId, size });
      if (zipTarget.kind === "cancelled") {
        setDownloading(false);
        setDownloadProgress(0);
        return;
      }
      setDownloadLabel("Preparing…");

      // Full resolution in a browser without the Save dialog (Safari, iPhone,
      // Firefox) goes out as several zips — say so first, with the Web & MLS
      // size beside it, when it's more than ~500 MB.
      if (zipTarget.kind === "parts" && size === "full" && usesZipParts()) {
        const est = await estimateSizes(targets);
        if (est && est.full > 500 * 1024 * 1024) {
          const zips = Math.max(2, Math.ceil(est.full / partLimitBytes()));
          const go = window.confirm(
            `Full resolution is ${formatBytes(est.full)} — it'll save as about ${zips} zips. Web & MLS is ${formatBytes(est.web)}.\n\nOK to continue at full resolution, or Cancel and pick Web & MLS from the size menu.`
          );
          if (!go) {
            setDownloading(false);
            setDownloadProgress(0);
            setDownloadLabel(null);
            return;
          }
        }
      }
    }

    const { urls: fresh, ext: madeExt, bytes: madeBytes } = await signForDownload(targets, size);
    const extFor = extWith(madeExt);

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
        const filename = `${vessel ? `${vessel} – ` : ""}${label}${sizeInfo.suffix ? ` (${sizeInfo.suffix})` : ""}.${ext}`;
        triggerDownload(blob, filename);
        // Log download silently (fire-and-forget)
        logDownload(1);
        onFinished();
      } catch {
        onMessage({ kind: "error", text: "That photo couldn't be downloaded. Please try again in a moment.", ms: 6000 });
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
        setDownloadProgress(p.total ? Math.round((p.done / p.total) * 100) : 0);
        setDownloadLabel(
          `${p.parts && p.parts > 1 ? `Part ${p.part} of ${p.parts} · ` : ""}${p.done} of ${p.total} photos · ${formatBytes(p.bytes)}`
        );
      },
    });
    setDownloading(false);
    setDownloadProgress(0);
    setDownloadLabel(null);
    if (!result.ok) {
      setZipFailed(targets);
      onMessage({ kind: "error", text: `${result.error} Or use Save as separate files.`, ms: 12000 });
      return;
    }
    logDownload(result.written);
    onFinished();
    if (result.failed > 0) {
      onMessage({
        kind: "error",
        text: `Saved ${result.written} photos${result.parts > 1 ? ` in ${result.parts} zip files` : ""}. ${result.failed} couldn't be downloaded — download ${result.failed !== 1 ? "them" : "it"} again on ${result.failed !== 1 ? "their" : "its"} own.`,
        ms: 10000,
      });
    } else {
      onMessage({
        kind: "success",
        text: `Saved ${result.written} photos (${formatBytes(result.bytes)})${result.parts > 1 ? ` in ${result.parts} zip files` : ""}.`,
        ms: 5000,
      });
    }
  }

  return {
    downloading, downloadProgress, downloadLabel, downloadSize, setDownloadSize, downloadTitle, downloadPhotos,
    saveSeparately, savingSeparately, cancelDownload,
    /** After a failed zip: save the same photos as separate files (null when nothing failed). */
    retrySeparately: zipFailed ? () => saveSeparately(zipFailed) : null,
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
}) {
  const { supabase, vesselName, photos, onMessage, onFinished } = opts;
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

  async function savePhotos(targets: ListingPhoto[]) {
    if (targets.length === 0 || saveLocked) return;
    setSaveError(null);
    if (shouldUseShareSheet()) {
      await prepareShareBatch(targets, 0);
      return;
    }
    // Several photos on a desktop: a streaming zip (src/lib/zipDownload.ts) —
    // full-resolution shoots are several GB, far more than fits in memory.
    // The Save dialog is opened first, while the click still counts.
    if (targets.length > 1 && !isTouchDevice()) {
      const base = (vesselName ?? "photos").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "photos";
      const target = await openZipTarget(`${base}-photos.zip`);
      if (target.kind === "cancelled") return;
      setSaveBusy({ done: 0, total: targets.length });
      try {
        const items = await saveItems(targets);
        const result = await writeZip(target, items.map((it) => ({ name: it.name, url: it.url })), {
          baseName: `${base}-photos`,
          onProgress: (p) => setSaveBusy({ done: p.done, total: p.total }),
        });
        if (!result.ok) setSaveError(result.error);
        else {
          const missed = result.failed + (targets.length - items.length);
          if (missed > 0) setSaveError(`${missed} photo${missed !== 1 ? "s" : ""} couldn't be downloaded; the rest were saved.`);
          else onMessage({ kind: "success", text: `${result.written} photos saved${result.parts > 1 ? ` in ${result.parts} zip files` : ""}.`, ms: 4000 });
          onFinished();
        }
      } catch {
        setSaveError("The download didn't finish. Please try again.");
      } finally {
        setSaveBusy(null);
      }
      return;
    }
    setSaveBusy({ done: 0, total: targets.length });
    try {
      const items = await saveItems(targets);
      const { files, failed } = await fetchPhotoFiles(items, (done, total) => setSaveBusy({ done, total }));
      if (files.length === 0) {
        setSaveError("Couldn't get the photos. Check your connection and try again.");
        return;
      }
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
    } catch {
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
