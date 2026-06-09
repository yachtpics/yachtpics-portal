"use client";

import { useState } from "react";
import JSZip from "jszip";

type Photo = {
  id: string;
  url: string | null;
  filename: string | null;
  category: string | null;
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
}: {
  token: string;
  vesselName: string;
  photos: Photo[];
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const available = photos.filter((p) => p.url);
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#050b14] text-white">
        <div className="max-w-5xl mx-auto px-5 py-6 sm:py-8">
          <p className="text-sm font-semibold tracking-wide mb-3">
            YachtPics <span className="text-[#d4a843]">Portal</span>
          </p>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">{vesselName}</h1>
              <p className="text-sm text-gray-400 mt-1">
                {available.length} photo{available.length !== 1 ? "s" : ""} available to download
              </p>
            </div>
            <button
              onClick={downloadAll}
              disabled={busy || available.length === 0}
              className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-5 py-3 rounded-lg transition-colors shrink-0"
            >
              {busy ? `Preparing… ${progress}%` : `⬇ Download all (${available.length})`}
            </button>
          </div>
          {busy && (
            <div className="mt-4 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#d4a843] transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Gallery */}
      <div className="max-w-5xl mx-auto px-5 py-6">
        {available.length === 0 ? (
          <p className="text-sm text-gray-500 py-12 text-center">
            There are no photos available for this listing yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {available.map((photo) => (
              <div
                key={photo.id}
                className="group relative aspect-[4/3] rounded-lg overflow-hidden bg-gray-200"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url!}
                  alt={photo.category ?? "Photo"}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => downloadOne(photo)}
                  disabled={busy || downloadingId === photo.id}
                  className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors"
                  aria-label="Download photo"
                >
                  <span className="opacity-0 group-hover:opacity-100 bg-white text-[#050b14] text-xs font-semibold px-3 py-1.5 rounded-full transition-opacity">
                    {downloadingId === photo.id ? "Downloading…" : "⬇ Download"}
                  </span>
                </button>
                {photo.category && (
                  <span className="absolute bottom-1.5 left-1.5 bg-black/55 text-white text-[10px] font-medium px-2 py-0.5 rounded">
                    {photo.category}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Copyright notice */}
        <div className="mt-8 border-t border-gray-200 pt-5">
          <p className="text-xs text-gray-400 leading-relaxed max-w-2xl">
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
