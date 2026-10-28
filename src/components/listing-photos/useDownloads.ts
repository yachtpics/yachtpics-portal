"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runPool } from "@/lib/uploadListingPhoto";
import {
  SHARE_BATCH, shouldUseShareSheet, isTouchDevice, photoFileName, fetchPhotoFiles,
  sharePhotoFiles, saveFilesSequentially, saveFilesAsZip,
} from "@/lib/photoSave";
import type { ListingPhoto, OnPhotoMessage } from "./types";
import { resizeImageBlob, signOriginalsInBrowser } from "@/lib/photoStoreClient";

// Two ways photos leave a listing page, one per role:
//
//  • useSizedDownloads — broker page. Size menu (Full / Web & MLS / Social),
//    links signed by /api/listings/[id]/photos/download-urls at download
//    time, zip for several, every download logged for the broker.
//  • useOriginalSave — admin page. Full-size originals for Charlie's own copy
//    (no licence, no download log); on a phone they go to the share sheet.

/** Download sizes offered to brokers. Resized ones are Supabase transforms
 *  signed by /api/listings/[id]/photos/download-urls (long edge capped). */
export type DownloadSize = "full" | "web" | "social";
export const DOWNLOAD_SIZES: { value: DownloadSize; label: string; short: string; suffix: string }[] = [
  { value: "full", label: "Full resolution", short: "Full resolution", suffix: "" },
  { value: "web", label: "Web & MLS (2048px)", short: "Web & MLS", suffix: "2048px" },
  { value: "social", label: "Social (1080px)", short: "Social", suffix: "1080px" },
];
// Resized downloads are made on the fly by Supabase, which answers 429 to a
// burst — so a zip of them fetches a few at a time. Originals can go wider.
const RESIZED_FETCH_CONCURRENCY = 6;
const ORIGINAL_FETCH_CONCURRENCY = 8;

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
}) {
  const { listingId, vesselName, onMessage, onFinished } = opts;
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  // Download size for every download button on the page (remembered per browser).
  const [downloadSize, setDownloadSizeState] = useState<DownloadSize>("full");
  function setDownloadSize(v: DownloadSize) {
    setDownloadSizeState(v);
    try { localStorage.setItem("yp_download_size", v); } catch { /* private mode */ }
  }
  useEffect(() => {
    try {
      const v = localStorage.getItem("yp_download_size");
      if (v === "full" || v === "web" || v === "social") setDownloadSizeState(v);
    } catch { /* private mode */ }
  }, []);

  /** Tooltip for the per-photo download button — names the chosen size. */
  const downloadTitle = downloadSize === "full"
    ? "Download photo"
    : `Download photo (${DOWNLOAD_SIZES.find((o) => o.value === downloadSize)?.label})`;

  /**
   * Fresh download links for these photos at the chosen size, signed by the
   * server at download time (re-checks access; never reuses page-load links,
   * which expire). Full resolution are the originals; the others are resized
   * by Supabase when fetched.
   */
  const extOf = (p: ListingPhoto) => (p.filename?.split(".").pop() ?? "jpg").toLowerCase();

  // Photos whose resized download the page makes itself (originals on R2,
  // which Supabase can't resize): id → long edge + output type.
  type ResizeSpec = { edge: number; type: string };
  async function signForDownload(targets: ListingPhoto[], size: DownloadSize): Promise<{ urls: Record<string, string>; resize: Record<string, ResizeSpec> }> {
    if (targets.length === 0) return { urls: {}, resize: {} };
    try {
      const res = await fetch(`/api/listings/${listingId}/photos/download-urls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: targets.map((t) => t.id), size }),
      });
      if (!res.ok) return { urls: {}, resize: {} };
      const d = await res.json().catch(() => null);
      return { urls: (d?.urls ?? {}) as Record<string, string>, resize: (d?.resize ?? {}) as Record<string, ResizeSpec> };
    } catch {
      return { urls: {}, resize: {} };
    }
  }

  /**
   * The file for one photo: fetched, and scaled down here when the server
   * said so. A re-encoded HEIC/TIFF/WebP becomes a .jpg; if this browser
   * can't decode the original, the full-size file is saved instead.
   */
  async function photoBlob(photo: ListingPhoto, url: string, resize: Record<string, ResizeSpec>): Promise<{ blob: Blob; ext: string }> {
    const blob = await fetchBlobWithRetry(url);
    const spec = resize[photo.id];
    const ext = extOf(photo);
    if (!spec) return { blob, ext };
    try {
      const out = await resizeImageBlob(blob, spec.edge, spec.type);
      return { blob: out, ext: spec.type === "image/png" ? "png" : ext === "jpeg" ? "jpeg" : "jpg" };
    } catch {
      return { blob, ext };
    }
  }

  async function downloadPhotos(targets: ListingPhoto[]) {
    if (targets.length === 0) return;
    setDownloading(true);
    setDownloadProgress(0);

    const size = downloadSize;
    const sizeInfo = DOWNLOAD_SIZES.find((s) => s.value === size) ?? DOWNLOAD_SIZES[0];
    const cleanName = (t: string) => t.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    const vessel = vesselName ? cleanName(vesselName) : "";

    const { urls: fresh, resize } = await signForDownload(targets, size);

    // Single photo — direct download, no ZIP needed
    if (targets.length === 1) {
      const photo = targets[0];
      try {
        const url = fresh[photo.id];
        if (!url) throw new Error("no link");
        const { blob, ext } = await photoBlob(photo, url, resize);
        // "Sea Dream – Salon.jpg": the vessel name keeps a loose download
        // identifiable in a Downloads folder full of "Salon.jpg"s. Resized
        // copies say their size so they can't be mistaken for the original.
        const label = cleanName(photo.category ?? "Photo") || "Photo";
        const filename = `${vessel ? `${vessel} – ` : ""}${label}${sizeInfo.suffix ? ` (${sizeInfo.suffix})` : ""}.${ext}`;
        triggerDownload(blob, filename);
        // Log download silently (fire-and-forget)
        fetch(`/api/listings/${listingId}/log-download`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoCount: 1 }),
        }).catch(() => {});
        onFinished();
      } catch {
        onMessage({ kind: "error", text: "That photo couldn't be downloaded. Please try again in a moment.", ms: 6000 });
      }
      setDownloading(false);
      setDownloadProgress(0);
      return;
    }

    // Multiple photos — ZIP, all inside a "{Vessel}/" folder, named
    // "{nn} {Category}.jpg" so they sort in listing order.
    // STORE (no compression): JPEGs are already compressed, so this makes zip
    // generation 5-10x faster. JSZip is loaded on demand — it's sizeable and
    // only needed when someone actually zips photos.
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const folder = vessel || "Photos";
    const pad = Math.max(2, String(targets.length).length);
    let fetched = 0;
    let added = 0;

    await runPool(
      targets,
      size === "full" ? ORIGINAL_FETCH_CONCURRENCY : RESIZED_FETCH_CONCURRENCY,
      async (photo, index) => {
        const url = fresh[photo.id];
        try {
          if (url) {
            const { blob, ext } = await photoBlob(photo, url, resize);
            const label = cleanName(photo.category ?? "Photo") || "Photo";
            zip.file(`${folder}/${String(index + 1).padStart(pad, "0")} ${label}.${ext}`, blob);
            added++;
          }
        } catch { /* counted below */ }
        fetched++;
        // Fetch phase = 0–85% of progress
        setDownloadProgress(Math.round((fetched / targets.length) * 85));
      }
    );
    const failedCount = targets.length - added;

    if (added === 0) {
      setDownloading(false);
      setDownloadProgress(0);
      onMessage({ kind: "error", text: "None of those photos could be downloaded. Please try again in a moment.", ms: 8000 });
      return;
    }

    // Zip generation phase = 85–100%
    setDownloadProgress(88);
    const zipBlob = await zip.generateAsync(
      { type: "blob", compression: "STORE" },
      (meta) => setDownloadProgress(88 + Math.round(meta.percent * 0.12))
    );
    const zipName = `${vesselName ? cleanName(vesselName) : "photos"}-photos${sizeInfo.suffix ? `-${sizeInfo.suffix}` : ""}.zip`;

    const finish = () => {
      fetch(`/api/listings/${listingId}/log-download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoCount: added }),
      }).catch(() => {});
      setDownloading(false);
      setDownloadProgress(0);
      onFinished();
      if (failedCount > 0) {
        onMessage({
          kind: "error",
          text: `${failedCount} photo${failedCount !== 1 ? "s" : ""} couldn't be added to the zip — download ${failedCount !== 1 ? "them" : "it"} again on ${failedCount !== 1 ? "their" : "its"} own.`,
          ms: 10000,
        });
      }
    };

    if ("showSaveFilePicker" in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: zipName,
          types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(zipBlob);
        await writable.close();
        finish();
        return;
      } catch (err) {
        // The broker closed the Save dialog: that's a "no", not a cue to
        // download anyway. Anything else (picker unsupported in this
        // context, write failed) falls through to a normal download.
        if (err instanceof DOMException && err.name === "AbortError") {
          setDownloading(false);
          setDownloadProgress(0);
          return;
        }
      }
    }

    triggerDownload(zipBlob, zipName);
    finish();
  }

  return { downloading, downloadProgress, downloadSize, setDownloadSize, downloadTitle, downloadPhotos };
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
