"use client";

import { useEffect, useRef, useState } from "react";
import { folderSaveSupported, formatBytes, openFolderTarget, openZipTarget, saveToFolder, writeZip } from "@/lib/zipDownload";
import RetryImg from "@/components/RetryImg";
import { photoAlt } from "@/lib/photoAlt";
import PresentedThrough from "@/components/PresentedThrough";
import { FolderDownloadHint } from "@/components/listing-photos/DownloadControls";

type Photo = {
  id: string;
  /** Full-size original — what gets downloaded. */
  url: string | null;
  /** 600px preview for the tile. */
  thumbUrl?: string | null;
  filename: string | null;
  category: string | null;
};

type Video = {
  id: string;
  previewUrl: string | null;
  posterUrl?: string | null;
  downloadUrl: string | null;
  label: string;
};

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DownloadPageClient({
  token,
  vesselName,
  photos,
  videos = [],
}: {
  token: string;
  vesselName: string;
  photos: Photo[];
  videos?: Video[];
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [zipError, setZipError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // "Save to a folder" (Chrome / Edge on a computer; no zip — office PCs that block zip files).
  const [canFolder, setCanFolder] = useState(false);
  useEffect(() => { setCanFolder(folderSaveSupported()); }, []);
  const [sepLabel, setSepLabel] = useState<string | null>(null);
  const [sepDone, setSepDone] = useState<string | null>(null);
  const sepAbort = useRef<AbortController | null>(null);
  const available = photos.filter((p) => p.url);
  const availableVideos = videos.filter((v) => v.downloadUrl);
  // Chrome / Edge on a computer: "Download all" saves straight into a folder; the zip is "or as a .zip".
  const useFolder = canFolder && available.length > 1;
  const safeName = vesselName.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "vessel";

  function logDownload(count: number) {
    fetch(`/api/d/${token}/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoCount: count }),
    }).catch(() => {});
  }

  async function downloadOne(photo: Photo) {
    if (!photo.url || busy) return;
    setDownloadingId(photo.id);
    try {
      const res = await fetch(photo.url);
      const blob = await res.blob();
      const ext = photo.filename?.split(".").pop() ?? "jpg";
      triggerDownload(blob, `${photo.category ?? "photo"}.${ext}`);
      logDownload(1);
    } catch {
      /* ignore */
    } finally {
      setDownloadingId(null);
    }
  }

  // Call straight from the click: the folder picker needs it.
  async function saveSeparately() {
    if (busy || available.length === 0) return;
    const folder = await openFolderTarget(`${vesselName} – Photos`);
    if (folder.kind === "cancelled") return;
    if (folder.kind === "unsupported") return downloadAll();
    setBusy(true);
    setProgress(0);
    setZipError(null);
    setSepDone(null);
    setSepLabel("Preparing…");
    const ctl = new AbortController();
    sepAbort.current = ctl;
    const res = await saveToFolder(
      folder,
      available.map((photo, k) => ({
        name: `${String(k + 1).padStart(2, "0")} ${photo.category ?? "Photo"}.${photo.filename?.split(".").pop() ?? "jpg"}`,
        url: photo.url,
      })),
      {
        signal: ctl.signal,
        onProgress: (p) => {
          setProgress(p.total ? Math.round((p.done / p.total) * 100) : 0);
          setSepLabel(`${p.done} of ${p.total} photos`);
        },
      }
    );
    sepAbort.current = null;
    if (res.written > 0) logDownload(res.written);
    setSepLabel(null);
    setBusy(false);
    setProgress(0);
    if (res.fallback) {
      setZipError("That folder couldn't be written to — use Download all instead.");
      return;
    }
    if (res.cancelled) setSepDone(`Stopped — ${res.written} of ${available.length} photos saved to ${folder.path}.`);
    else if (res.written === 0) setZipError("The photos couldn't be downloaded. Please try again in a moment.");
    else setSepDone(`Saved ${res.written} photos to ${folder.path} (${formatBytes(res.bytes)})${res.failed ? `; ${res.failed} couldn't be downloaded` : ""}.`);
  }

  async function downloadAll() {
    if (busy || available.length === 0) return;
    setBusy(true);
    setProgress(0);
    setZipError(null);
    try {
      // Single photo — no need to zip
      if (available.length === 1) {
        const only = available[0];
        const res = await fetch(only.url!);
        const blob = await res.blob();
        const ext = only.filename?.split(".").pop() ?? "jpg";
        triggerDownload(blob, `${only.category ?? "photo"}.${ext}`);
        logDownload(1);
        setBusy(false);
        return;
      }

      // Streaming zip (src/lib/zipDownload.ts): straight into the picked file
      // on Chrome / Edge (any size), ≤ 1 GB parts elsewhere.
      const target = await openZipTarget(`${safeName}-photos.zip`);
      if (target.kind === "cancelled") return;
      const result = await writeZip(
        target,
        available.map((photo, k) => ({
          name: `${String(k + 1).padStart(2, "0")}-${photo.category ?? "photo"}.${photo.filename?.split(".").pop() ?? "jpg"}`,
          url: photo.url,
        })),
        {
          baseName: `${safeName}-photos`,
          onProgress: (p) => setProgress(p.total ? Math.round((p.done / p.total) * 100) : 0),
        }
      );
      if (!result.ok) {
        setZipError(result.error);
        return;
      }
      setZipError(result.failed ? `${result.failed} photo${result.failed === 1 ? "" : "s"} couldn't be downloaded; the rest were saved.` : null);
      logDownload(result.written);
      setProgress(100);
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => {
        setBusy(false);
        setProgress(0);
      }, 600);
    }
  }

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Header — ink band with the wordmark treatment */}
      <div className="bg-ink-950 text-white">
        <div className="max-w-5xl mx-auto px-5 py-6 sm:py-8">
          <p className="label-caps-inverse text-accent-300 mb-4">YachtPics Portal</p>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{vesselName}</h1>
              <p className="text-sm text-ink-400 mt-1">
                {available.length} photo{available.length !== 1 ? "s" : ""}
                {availableVideos.length > 0 && ` · ${availableVideos.length} video${availableVideos.length !== 1 ? "s" : ""}`}
                {" "}available to download
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={useFolder ? saveSeparately : downloadAll}
              disabled={busy || available.length === 0}
              title={useFolder ? "Pick a folder — the photos are saved straight into it" : undefined}
              className="bg-accent-500 hover:bg-accent-400 disabled:opacity-40 disabled:cursor-not-allowed text-ink-950 text-sm font-semibold px-5 py-3 min-h-[44px] rounded-ctl transition-colors duration-base ease-quiet shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
            >
              {sepLabel ?? (busy ? `Downloading… ${progress}%` : `⬇ Download all (${available.length})`)}
            </button>
            {sepLabel !== null ? (
              <button
                onClick={() => sepAbort.current?.abort()}
                className="text-sm text-white/80 hover:text-white underline underline-offset-2 px-2 min-h-[44px]"
              >
                Cancel
              </button>
            ) : useFolder && (
              <button
                onClick={downloadAll}
                disabled={busy}
                className="text-sm text-white/70 hover:text-white underline underline-offset-2 px-2 min-h-[44px] disabled:opacity-40"
              >
                or as a .zip
              </button>
            )}
            </div>
          </div>
          {busy && (
            <div className="mt-4 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-500 transition-all duration-base ease-quiet"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          {!busy && zipError && (
            <p className="mt-3 text-sm text-danger-300">
              {zipError}{" "}
              {canFolder && available.length > 1 && (
                <button onClick={saveSeparately} className="underline underline-offset-2 text-white hover:text-accent-300 font-medium">
                  Save to a folder instead
                </button>
              )}
            </p>
          )}
          {!busy && sepDone && <p className="mt-3 text-sm text-white/80">{sepDone}</p>}
          <FolderDownloadHint show={useFolder} />
        </div>
      </div>

      {/* Videos — preview inline, download individually (files are large, so no zip) */}
      {availableVideos.length > 0 && (
        <div className="max-w-5xl mx-auto px-5 pt-6">
          <p className="label-caps text-ink-500 mb-3">
            Video{availableVideos.length !== 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {availableVideos.map((video) => (
              <div key={video.id} className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden">
                {video.previewUrl && (
                  <video
                    src={video.previewUrl}
                    poster={video.posterUrl ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[320px] bg-black"
                  />
                )}
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm text-ink-700 truncate">{video.label}</span>
                  <a
                    href={video.downloadUrl!}
                    onClick={() => logDownload(1)}
                    className="shrink-0 bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-base ease-quiet"
                  >
                    ⬇ Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gallery — prints on paper, lifted by their shadows */}
      <div className="max-w-5xl mx-auto px-5 py-6">
        {available.length === 0 ? (
          <p className="text-sm text-ink-500 py-12 text-center">
            There are no photos available for this listing yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {available.map((photo) => (
              <div
                key={photo.id}
                className="group relative aspect-[4/3] rounded-[2px] overflow-hidden bg-white shadow-print"
              >
                <RetryImg
                  src={photo.thumbUrl ?? photo.url!}
                  fallbackSrc={photo.thumbUrl ? photo.url ?? undefined : undefined}
                  alt={photoAlt(photo.category, vesselName)}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-contain"
                />
                <button
                  onClick={() => downloadOne(photo)}
                  disabled={busy || downloadingId === photo.id}
                  className="absolute inset-0 flex items-center justify-center bg-ink-950/0 group-hover:bg-ink-950/30 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50"
                  aria-label="Download photo"
                >
                  <span className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 border border-hairline bg-white text-ink-950 text-xs font-semibold px-3 py-2 rounded-full shadow-elev-1 transition-opacity duration-base ease-quiet">
                    {downloadingId === photo.id ? "Downloading…" : "⬇ Download"}
                  </span>
                </button>
                {photo.category && (
                  <span className="pointer-events-none absolute bottom-1.5 left-1.5 label-caps text-ink-600 border border-hairline bg-white/90 px-2 py-0.5 rounded-[3px]">
                    {photo.category}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Copyright notice */}
        <div className="mt-8 border-t border-hairline pt-5">
          <p className="text-xs text-ink-500 leading-relaxed max-w-2xl">
            All photos are the intellectual property of YachtPics and are licensed solely to
            advertise this specific vessel. They may not be transferred, resold, sublicensed, or
            used by any other party without written permission from YachtPics. © {new Date().getFullYear()} YachtPics.
            All rights reserved.
          </p>
        </div>
        <PresentedThrough className="mt-6 pb-2" />
      </div>
    </div>
  );
}
