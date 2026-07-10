"use client";

import { useState } from "react";
import JSZip from "jszip";

type Photo = { id: string; filename: string | null; category: string | null; is_visible: boolean | null; url: string | null };
type Video = { id: string; filename: string | null; url: string | null };

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

export default function ClientGalleryView({
  galleryId,
  title,
  photos: initialPhotos,
  videos,
  expired,
  expiresAt,
  slideshowUrl,
  mediaByYachtPics = true,
}: {
  galleryId: string;
  title: string;
  photos: Photo[];
  videos: Video[];
  expired: boolean;
  expiresAt: string | null;
  slideshowUrl: string | null;
  mediaByYachtPics?: boolean;
}) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");

  const available = photos.filter((p) => p.url);
  const availableVideos = videos.filter((v) => v.url);
  const safeName = title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "gallery";

  function log(kind: "photo" | "video" | "zip", count: number) {
    fetch(`/api/client/galleries/${galleryId}/log-download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, count }),
    }).catch(() => {});
  }

  function copyLink() {
    if (!slideshowUrl) return;
    navigator.clipboard.writeText(slideshowUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  }

  async function sendSlideshow() {
    if (!sendEmail.trim()) return;
    setSending(true);
    setSendMsg("");
    try {
      const res = await fetch(`/api/client/galleries/${galleryId}/send-slideshow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: sendEmail.trim(), message: sendMessage.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setSendMsg(`Sent to ${sendEmail.trim()} ✓`);
      setSendEmail("");
      setSendMessage("");
      setTimeout(() => { setSendOpen(false); setSendMsg(""); }, 1500);
    } catch (e) {
      setSendMsg(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  function toggleVisible(photo: Photo) {
    const nv = !(photo.is_visible ?? true);
    setPhotos((prev) => prev.map((x) => (x.id === photo.id ? { ...x, is_visible: nv } : x)));
    fetch(`/api/client/galleries/${galleryId}/photos`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "visibility", photoId: photo.id, isVisible: nv }),
    }).catch(() => {});
  }

  function onPhotoDrop(toIndex: number) {
    const from = dragIndex;
    setDragIndex(null);
    if (from === null || from === toIndex) return;
    setPhotos((prev) => {
      const arr = [...prev];
      const [moved] = arr.splice(from, 1);
      arr.splice(toIndex, 0, moved);
      fetch(`/api/client/galleries/${galleryId}/photos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder", orderedIds: arr.map((p) => p.id) }),
      }).catch(() => {});
      return arr;
    });
  }

  async function downloadOne(photo: Photo) {
    if (!photo.url || busy || expired) return;
    setDownloadingId(photo.id);
    try {
      const res = await fetch(photo.url);
      const blob = await res.blob();
      const ext = photo.filename?.split(".").pop() ?? "jpg";
      triggerDownload(blob, photo.filename ?? `${photo.category ?? "photo"}.${ext}`);
      log("photo", 1);
    } catch {
      /* ignore */
    } finally {
      setDownloadingId(null);
    }
  }

  async function downloadVideo(v: Video) {
    if (!v.url || busy || expired) return;
    setDownloadingId(v.id);
    try {
      const res = await fetch(v.url);
      const blob = await res.blob();
      const ext = v.filename?.split(".").pop() ?? "mp4";
      triggerDownload(blob, v.filename ?? `video.${ext}`);
      log("video", 1);
    } catch {
      /* ignore */
    } finally {
      setDownloadingId(null);
    }
  }

  async function downloadAll() {
    if (busy || expired || available.length === 0) return;
    setBusy(true);
    setProgress(0);
    try {
      if (available.length === 1) {
        const only = available[0];
        const res = await fetch(only.url!);
        const blob = await res.blob();
        const ext = only.filename?.split(".").pop() ?? "jpg";
        triggerDownload(blob, only.filename ?? `photo.${ext}`);
        log("photo", 1);
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
              zip.file(`${String(i + j + 1).padStart(2, "0")}-${photo.category ?? "photo"}.${ext}`, blob);
            } catch {
              /* skip */
            }
            fetched++;
            setProgress(Math.round((fetched / available.length) * 85));
          })
        );
      }
      setProgress(88);
      const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (m) => setProgress(88 + Math.round(m.percent * 0.12)));
      triggerDownload(zipBlob, `${safeName}-photos.zip`);
      log("zip", available.length);
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
    <div className="max-w-5xl mx-auto px-5 py-8">
      <a href="/client" className="text-ink-500 hover:text-ink-700 text-sm transition-colors duration-fast inline-flex items-center min-h-[44px]">&larr; Your galleries</a>

      <div className="mt-1 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-display text-ink-900">{title}</h1>
          <p className="text-sm text-ink-500 mt-1">
            {available.length} photo{available.length !== 1 ? "s" : ""}
            {availableVideos.length > 0 ? ` · ${availableVideos.length} video${availableVideos.length !== 1 ? "s" : ""}` : ""}
          </p>
        </div>
        {!expired && available.length > 0 && (
          <button
            onClick={downloadAll}
            disabled={busy}
            className="bg-accent-500 hover:bg-accent-400 disabled:opacity-40 disabled:cursor-not-allowed text-ink-950 text-sm font-semibold px-5 py-3 min-h-[44px] rounded-ctl transition-colors duration-base ease-quiet shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50"
          >
            {busy ? `Preparing… ${progress}%` : `⬇ Download all photos (${available.length})`}
          </button>
        )}
      </div>

      {busy && (
        <div className="mt-3 h-1.5 bg-ink-200 rounded-full overflow-hidden">
          <div className="h-full bg-accent-500 transition-all duration-base ease-quiet" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* Slideshow + expiry notices */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {slideshowUrl && (
          <>
            <a href={slideshowUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium px-4 py-2 min-h-[44px] inline-flex items-center rounded-ctl bg-ink-950 text-white hover:bg-ink-800 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50">
              ▶ Play slideshow
            </a>
            <button onClick={copyLink} className="text-sm font-medium px-4 py-2 min-h-[44px] rounded-ctl border border-hairline-strong bg-white text-ink-700 hover:border-ink-400 hover:text-ink-900 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500">
              {copied ? "Link copied ✓" : "Copy slideshow link to share"}
            </button>
            <button onClick={() => setSendOpen((o) => !o)} className="text-sm font-medium px-4 py-2 min-h-[44px] rounded-ctl border border-hairline-strong bg-white text-ink-700 hover:border-ink-400 hover:text-ink-900 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500">
              ✉ Email slideshow
            </button>
          </>
        )}
      </div>

      {slideshowUrl && sendOpen && (
        <div className="mt-3 max-w-md bg-white border border-hairline rounded-card shadow-elev-1 p-4 space-y-2">
          <p className="label-caps">Email this slideshow</p>
          <input
            type="email"
            value={sendEmail}
            onChange={(e) => setSendEmail(e.target.value)}
            placeholder="recipient@email.com"
            className="w-full text-sm text-ink-900 placeholder:text-ink-400 border border-hairline-strong rounded-ctl px-3 py-2 min-h-[44px] focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40 transition-colors duration-fast"
          />
          <textarea
            value={sendMessage}
            onChange={(e) => setSendMessage(e.target.value)}
            placeholder="Optional message…"
            rows={2}
            className="w-full text-sm text-ink-900 placeholder:text-ink-400 border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40 transition-colors duration-fast resize-none"
          />
          {sendMsg && <p className="text-xs text-ink-600">{sendMsg}</p>}
          <div className="flex gap-2">
            <button
              onClick={sendSlideshow}
              disabled={sending || !sendEmail.trim()}
              className="bg-ink-950 hover:bg-ink-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 min-h-[44px] rounded-ctl transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              {sending ? "Sending…" : "Send"}
            </button>
            <button onClick={() => setSendOpen(false)} className="text-sm font-medium px-3 py-2 min-h-[44px] rounded-ctl text-ink-500 hover:text-ink-700 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500">
              Cancel
            </button>
          </div>
        </div>
      )}

      {expired && (
        <div className="mt-4 bg-warn-50 border border-warn-200 rounded-ctl px-4 py-3">
          <p className="text-sm text-warn-800">
            Downloads for this gallery have closed{expiresAt ? ` (as of ${new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })})` : ""}. You can still view and share the slideshow. Contact YachtPics if you need the files again.
          </p>
        </div>
      )}

      {/* Videos */}
      {availableVideos.length > 0 && (
        <div className="mt-8">
          <h2 className="label-caps mb-3">Videos</h2>
          <div className="space-y-2">
            {availableVideos.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 bg-white border border-hairline rounded-ctl shadow-elev-1 px-4 py-3">
                <span className="text-sm text-ink-700 truncate">🎬 {v.filename ?? "Video"}</span>
                {!expired ? (
                  <button onClick={() => downloadVideo(v)} disabled={busy || downloadingId === v.id} className="text-sm font-medium text-accent-700 hover:text-accent-600 disabled:opacity-40 shrink-0 min-h-[44px] transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 rounded-sm px-1">
                    {downloadingId === v.id ? "Downloading…" : "⬇ Download"}
                  </button>
                ) : (
                  <span className="text-xs text-ink-400 shrink-0">Closed</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Photo grid — prints on paper, lifted by their shadows */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="label-caps">Photos</h2>
          {slideshowUrl && photos.length > 1 && (
            <p className="text-xs text-ink-500">Drag to reorder · 👁 to hide from the slideshow (still downloadable)</p>
          )}
        </div>
        {photos.length === 0 ? (
          <p className="text-sm text-ink-500">No photos in this gallery yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {photos.map((photo, i) => (
              <div
                key={photo.id}
                draggable={!!slideshowUrl}
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onPhotoDrop(i)}
                className={`group relative aspect-[4/3] rounded-[2px] overflow-hidden bg-white shadow-print transition-opacity duration-base ease-quiet ${slideshowUrl ? "cursor-move" : ""} ${dragIndex === i ? "ring-2 ring-accent-500" : ""} ${photo.is_visible === false ? "opacity-50" : ""}`}
              >
                {photo.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.url} alt={photo.category ?? "Photo"} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                )}

                {slideshowUrl && (
                  <button
                    onClick={() => toggleVisible(photo)}
                    className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 border border-hairline bg-white hover:bg-ink-50 text-ink-700 text-xs w-8 h-8 rounded-full shadow-elev-1 transition-opacity duration-base ease-quiet flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                    title={photo.is_visible === false ? "Show in slideshow" : "Hide from slideshow"}
                  >
                    {photo.is_visible === false ? "🚫" : "👁"}
                  </button>
                )}

                {!expired && photo.url && (
                  <button
                    onClick={() => downloadOne(photo)}
                    disabled={busy || downloadingId === photo.id}
                    className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 border border-hairline bg-white hover:bg-ink-50 text-ink-950 text-xs font-semibold px-3 py-1.5 rounded-full shadow-elev-1 transition-opacity duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                  >
                    {downloadingId === photo.id ? "…" : "⬇ Download"}
                  </button>
                )}

                {photo.is_visible === false && (
                  <span className="pointer-events-none absolute bottom-1.5 left-1.5 bg-ink-950/70 text-white text-[9px] px-1.5 py-0.5 rounded-[3px]">Hidden from slideshow</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-10 border-t border-hairline pt-5">
        <p className="text-xs text-ink-500 leading-relaxed max-w-2xl">
          {mediaByYachtPics
            ? `Photos and videos are provided by YachtPics for your use. © ${new Date().getFullYear()} YachtPics. All rights reserved.`
            : "Photos and videos are provided for your use. Please don't share or redistribute them without permission."}
        </p>
      </div>
    </div>
  );
}
