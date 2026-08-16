"use client";

import { useState } from "react";
import JSZip from "jszip";

type Photo = {
  id: string;
  url: string | null;
  filename: string | null;
  category: string | null;
};

type Video = {
  id: string;
  previewUrl: string | null;
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
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const available = photos.filter((p) => p.url);
  const availableVideos = videos.filter((v) => v.downloadUrl);
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

  async function downloadAll() {
    if (busy || available.length === 0) return;
    setBusy(true);
    setProgress(0);
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

      const zip = new JSZip();
      const BATCH = 8;
      let fetched = 0;

      for (let i = 0; i < available.length; i += BATCH) {
        const batch = available.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (photo, j) => {
            if (!photo.url) return;
            try {
              const res = await fetch(photo.url);
              const blob = await res.blob();
              const ext = photo.filename?.split(".").pop() ?? "jpg";
              const name = `${String(i + j + 1).padStart(2, "0")}-${photo.category ?? "photo"}.${ext}`;
              zip.file(name, blob);
            } catch {
              /* skip failed photo */
            }
            fetched++;
            setProgress(Math.round((fetched / available.length) * 85));
          })
        );
      }

      setProgress(88);
      const zipBlob = await zip.generateAsync(
        { type: "blob", compression: "STORE" },
        (meta) => setProgress(88 + Math.round(meta.percent * 0.12))
      );
      triggerDownload(zipBlob, `${safeName}-photos.zip`);
      logDownload(available.length);
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
            <button
              onClick={downloadAll}
              disabled={busy || available.length === 0}
              className="bg-accent-500 hover:bg-accent-400 disabled:opacity-40 disabled:cursor-not-allowed text-ink-950 text-sm font-semibold px-5 py-3 min-h-[44px] rounded-ctl transition-colors duration-base ease-quiet shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
            >
              {busy ? `Preparing… ${progress}%` : `⬇ Download all (${available.length})`}
            </button>
          </div>
          {busy && (
            <div className="mt-4 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-500 transition-all duration-base ease-quiet"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url!}
                  alt={photo.category ?? "Photo"}
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
      </div>
    </div>
  );
}
