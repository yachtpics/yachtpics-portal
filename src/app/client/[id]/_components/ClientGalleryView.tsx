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
      <a href="/client" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">&larr; Your galleries</a>

      <div className="mt-3 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {available.length} photo{available.length !== 1 ? "s" : ""}
            {availableVideos.length > 0 ? ` · ${availableVideos.length} video${availableVideos.length !== 1 ? "s" : ""}` : ""}
          </p>
        </div>
        {!expired && available.length > 0 && (
          <button
            onClick={downloadAll}
            disabled={busy}
            className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-5 py-3 rounded-lg transition-colors shrink-0"
          >
            {busy ? `Preparing… ${progress}%` : `⬇ Download all photos (${available.length})`}
          </button>
        )}
      </div>

      {busy && (
        <div className="mt-3 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-[#d4a843] transition-all duration-200" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* Slideshow + expiry notices */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {slideshowUrl && (
          <>
            <a href={slideshowUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium px-4 py-2 rounded-lg bg-[#050b14] text-white hover:bg-[#0c1626] transition-colors">
              ▶ Play slideshow
            </a>
            <button onClick={copyLink} className="text-sm font-medium px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:border-gray-300 transition-colors">
              {copied ? "Link copied ✓" : "Copy slideshow link to share"}
            </button>
            <button onClick={() => setSendOpen((o) => !o)} className="text-sm font-medium px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:border-gray-300 transition-colors">
              ✉ Email slideshow
            </button>
          </>
        )}
      </div>

      {slideshowUrl && sendOpen && (
        <div className="mt-3 max-w-md bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-700">Email this slideshow</p>
          <input
            type="email"
            value={sendEmail}
            onChange={(e) => setSendEmail(e.target.value)}
            placeholder="recipient@email.com"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843]"
          />
          <textarea
            value={sendMessage}
            onChange={(e) => setSendMessage(e.target.value)}
            placeholder="Optional message…"
            rows={2}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#d4a843] resize-none"
          />
          {sendMsg && <p className="text-xs text-gray-600">{sendMsg}</p>}
          <div className="flex gap-2">
            <button
              onClick={sendSlideshow}
              disabled={sending || !sendEmail.trim()}
              className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {sending ? "Sending…" : "Send"}
            </button>
            <button onClick={() => setSendOpen(false)} className="text-sm font-medium px-3 py-2 rounded-lg text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {expired && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-sm text-amber-800">
            Downloads for this gallery have closed{expiresAt ? ` (as of ${new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })})` : ""}. You can still view and share the slideshow. Contact YachtPics if you need the files again.
          </p>
        </div>
      )}

      {/* Videos */}
      {availableVideos.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Videos</h2>
          <div className="space-y-2">
            {availableVideos.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3">
                <span className="text-sm text-gray-700 truncate">🎬 {v.filename ?? "Video"}</span>
                {!expired ? (
                  <button onClick={() => downloadVideo(v)} disabled={busy || downloadingId === v.id} className="text-sm font-medium text-[#9a7a1f] hover:text-[#7d6219] shrink-0">
                    {downloadingId === v.id ? "Downloading…" : "⬇ Download"}
                  </button>
                ) : (
                  <span className="text-xs text-gray-400 shrink-0">Closed</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Photo grid */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Photos</h2>
          {slideshowUrl && photos.length > 1 && (
            <p className="text-xs text-gray-400">Drag to reorder · 👁 to hide from the slideshow (still downloadable)</p>
          )}
        </div>
        {photos.length === 0 ? (
          <p className="text-sm text-gray-500">No photos in this gallery yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos.map((photo, i) => (
              <div
                key={photo.id}
                draggable={!!slideshowUrl}
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onPhotoDrop(i)}
                className={`group relative aspect-[4/3] rounded-lg overflow-hidden bg-gray-200 ${slideshowUrl ? "cursor-move" : ""} ${dragIndex === i ? "ring-2 ring-[#d4a843]" : ""} ${photo.is_visible === false ? "opacity-50" : ""}`}
              >
                {photo.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.url} alt={photo.category ?? "Photo"} loading="lazy" className="w-full h-full object-cover pointer-events-none" />
                )}

                {slideshowUrl && (
                  <button
                    onClick={() => toggleVisible(photo)}
                    className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 bg-black/60 hover:bg-black/80 text-white text-xs w-7 h-7 rounded-full transition-opacity flex items-center justify-center"
                    title={photo.is_visible === false ? "Show in slideshow" : "Hide from slideshow"}
                  >
                    {photo.is_visible === false ? "🚫" : "👁"}
                  </button>
                )}

                {!expired && photo.url && (
                  <button
                    onClick={() => downloadOne(photo)}
                    disabled={busy || downloadingId === photo.id}
                    className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 bg-white text-[#050b14] text-xs font-semibold px-3 py-1.5 rounded-full transition-opacity"
                  >
                    {downloadingId === photo.id ? "…" : "⬇ Download"}
                  </button>
                )}

                {photo.is_visible === false && (
                  <span className="absolute bottom-1.5 left-1.5 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded">Hidden from slideshow</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-10 border-t border-gray-200 pt-5">
        <p className="text-xs text-gray-400 leading-relaxed max-w-2xl">
          {mediaByYachtPics
            ? `Photos and videos are provided by YachtPics for your use. © ${new Date().getFullYear()} YachtPics. All rights reserved.`
            : "Photos and videos are provided for your use. Please don't share or redistribute them without permission."}
        </p>
      </div>
    </div>
  );
}
