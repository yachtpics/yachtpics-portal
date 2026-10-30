"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import RetryImg from "@/components/RetryImg";
import { useProgressivePhotoUrls, type ClientPhotoUrls } from "@/lib/useSelfRefreshingUrls";
import PresentedThrough from "@/components/PresentedThrough";
import { photoAlt } from "@/lib/photoAlt";
import VideoStack, { videoLabel } from "@/components/VideoStack";
import { FolderDownloadHint } from "@/components/listing-photos/DownloadControls";
import { folderSaveSupported, openFolderTarget, openZipTarget, saveToFolder, writeZip, type ZipTarget } from "@/lib/zipDownload";

type GalleryPhoto = {
  id: string;
  /** Main-slide size (2000px box) — null until the viewer has asked for it. */
  url: string | null;
  /** Filmstrip / grid size (600px box). */
  thumbUrl?: string | null;
  /** Full-size original — only present while downloads are open. */
  downloadUrl?: string | null;
  category: string | null;
};
type GalleryVideo = { id?: string; url: string; filename: string | null; posterUrl?: string | null };

/** The slideshow and All Photos are photographs only; videos have their own tab. */
type Slide = { id: string; url: string | null; thumbUrl?: string | null; downloadUrl?: string | null; category: string | null };

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

/**
 * A photograph that reveals itself only once it has decoded — no pop-in,
 * no layout shift. Until the image arrives, a quiet paper shimmer holds
 * its place. Signed URLs stay raw <img> (never next/image — the optimizer
 * would cache expiring URLs).
 */
function FadePhoto({
  src,
  alt,
  eager = false,
  className = "",
  retries = 4,
  onError,
}: {
  src: string;
  alt: string;
  eager?: boolean;
  className?: string;
  retries?: number;
  onError?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const el = imgRef.current;
    // Neighbours are preloaded, so the incoming image is usually already
    // cached. Flipping to opacity-100 synchronously would skip the transition
    // entirely — the photo would just appear on top of the old one. Paint one
    // frame at opacity 0, then flip on the next frame so the fade actually runs.
    if (el && el.complete && el.naturalWidth > 0) {
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setLoaded(true));
      });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
  }, [src]);

  return (
    <>
      {/* Resized on first request by Supabase, which can 429 under load —
          RetryImg re-requests with backoff; onError lets old links re-sign. */}
      <RetryImg
        ref={imgRef}
        src={src}
        alt={alt}
        retries={retries}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => onError?.()}
        className={`${className} transition-opacity duration-[1200ms] ease-quiet ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </>
  );
}

export default function GallerySlideshow({
  slug,
  title,
  photos: initialPhotos,
  videos: initialVideos,
  downloadsEnabled = false,
  downloadsClosedNote = null,
  contact = null,
}: {
  slug: string;
  title: string;
  photos: GalleryPhoto[];
  videos: GalleryVideo[];
  downloadsEnabled?: boolean;
  /** Shown quietly under the header once the download window has closed. */
  downloadsClosedNote?: string | null;
  contact?: { name: string; email: string | null; phone: string | null } | null;
}) {
  // The page signs only the opening photo + first dozen tiles; the rest
  // arrive in chunks from /api/g/[slug]/urls just ahead of need, and all of
  // it is re-signed when a tab returns after the two-hour links went stale.
  const initialPhotoUrls = useMemo(() => {
    const map: ClientPhotoUrls = {};
    initialPhotos.forEach((p) => {
      if (p.url || p.thumbUrl) map[p.id] = { thumb: p.thumbUrl ?? null, full: p.url };
    });
    return map;
  }, [initialPhotos]);
  const initialExtras = useMemo(() => {
    const videoMap: Record<string, { url: string | null; posterUrl: string | null }> = {};
    initialVideos.forEach((v) => { if (v.id) videoMap[v.id] = { url: v.url, posterUrl: v.posterUrl ?? null }; });
    return { videos: videoMap };
  }, [initialVideos]);
  const { photos: livePhotos, extras: liveUrls, want, onMediaError } = useProgressivePhotoUrls({
    endpoint: `/api/g/${slug}/urls`,
    initialPhotos: initialPhotoUrls,
    initialExtras,
  });
  const photos = useMemo<GalleryPhoto[]>(
    () => initialPhotos.map((p) => {
      const u = livePhotos[p.id];
      return { ...p, url: u?.full ?? null, thumbUrl: u?.thumb ?? null };
    }),
    [initialPhotos, livePhotos]
  );
  const videos = useMemo<GalleryVideo[]>(
    () => initialVideos.map((v) => {
      const u = v.id ? liveUrls.videos?.[v.id] : undefined;
      return u ? { ...v, url: u.url ?? v.url, posterUrl: u.posterUrl ?? v.posterUrl ?? null } : v;
    }),
    [initialVideos, liveUrls]
  );
  const altFor = (category: string | null) => photoAlt(category, title);

  const slides = useMemo<Slide[]>(
    () => photos.map((p) => ({ id: p.id, url: p.url, thumbUrl: p.thumbUrl ?? null, downloadUrl: p.downloadUrl ?? null, category: p.category })),
    [photos]
  );

  const [downloadingAll, setDownloadingAll] = useState(false);
  const [dlProgress, setDlProgress] = useState(0);
  const [downloadingOne, setDownloadingOne] = useState(false);

  const [dlError, setDlError] = useState("");
  // "Save to a folder" (Chrome / Edge on a computer; no zip — office PCs that block zip files).
  const [canFolder, setCanFolder] = useState(false);
  useEffect(() => { setCanFolder(folderSaveSupported()); }, []);
  // Chrome / Edge on a computer: Download saves straight into a folder; the zip is "or as a .zip".
  const useFolder = canFolder && photos.length > 1;
  const [sepLabel, setSepLabel] = useState<string | null>(null);
  const [zipFailed, setZipFailed] = useState(false);
  const sepAbort = useRef<AbortController | null>(null);

  const logDownload = useCallback((count: number, kind: "single" | "zip") => {
    fetch(`/api/g/${slug}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemCount: count, kind }),
    }).catch(() => {});
  }, [slug]);

  /**
   * Mint fresh links right before downloading. The URLs this page was rendered
   * with expire; an expired link returns a small error document rather than
   * failing, which would otherwise be saved as a .jpg the visitor can't open.
   */
  const freshUrls = useCallback(async (): Promise<{ photos: (string | null)[]; videos: (string | null)[] } | null> => {
    try {
      const res = await fetch(`/api/g/${slug}/signed-urls`, { method: "POST" });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, [slug]);

  /** Fetch one file, refusing anything that isn't actually a file. */
  const fetchFile = useCallback(async (url: string): Promise<Blob> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`link expired (${res.status})`);
    const blob = await res.blob();
    if (blob.size < 1024 && !blob.type.startsWith("image/") && !blob.type.startsWith("video/")) {
      throw new Error("link expired");
    }
    return blob;
  }, []);

  // Download the photo currently on screen.
  const downloadCurrentSlide = useCallback(async (s: Slide, index: number) => {
    if (downloadingOne) return;
    setDownloadingOne(true);
    setDlError("");
    try {
      // Re-sign first — the URL rendered into this page may already be dead.
      const fresh = await freshUrls();
      // Photos fall back to the original signed with the page, never the
      // resized display copy — a download should be the real file.
      const url = fresh?.photos?.[index] ?? s.downloadUrl;
      if (!url) throw new Error("no link");
      const blob = await fetchFile(url);
      triggerDownload(blob, `${s.category ?? "photo"}.jpg`);
      logDownload(1, "single");
    } catch {
      setDlError("That file couldn't be downloaded — please refresh the page and try again.");
    } finally {
      setDownloadingOne(false);
    }
  }, [downloadingOne, logDownload, freshUrls, fetchFile]);

  // Download one video from the Video tab (index into `videos`, the same
  // order /signed-urls returns them in).
  const downloadVideo = useCallback(async (index: number) => {
    const v = videos[index];
    if (!v?.url || downloadingOne) return;
    setDownloadingOne(true);
    setDlError("");
    try {
      const fresh = await freshUrls();
      const url = fresh?.videos?.[index] ?? v.url;
      const blob = await fetchFile(url);
      triggerDownload(blob, v.filename ?? "video.mp4");
      logDownload(1, "single");
    } catch {
      setDlError("That file couldn't be downloaded — please refresh the page and try again.");
    } finally {
      setDownloadingOne(false);
    }
  }, [videos, downloadingOne, logDownload, freshUrls, fetchFile]);

  // Zip every photo. Videos are excluded from the zip (they can be large) — the
  // Video tab downloads those one at a time.
  const downloadAllPhotos = useCallback(async () => {
    if (downloadingAll || photos.length === 0) return;
    // Several photos: open the Save dialog first, while the click still
    // counts (streaming zip — src/lib/zipDownload.ts).
    const safeTitle = title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "gallery";
    let target: ZipTarget | null = null;
    if (photos.length > 1) {
      target = await openZipTarget(`${safeTitle}-photos.zip`);
      if (target.kind === "cancelled") return;
    }
    setDownloadingAll(true);
    setDlProgress(0);
    setDlError("");
    try {
      // Re-sign everything before pulling it down; a large set outlives the
      // links this page was rendered with.
      const fresh = await freshUrls();

      if (photos.length === 1) {
        const only = fresh?.photos?.[0] ?? photos[0].downloadUrl;
        if (!only) throw new Error("no link");
        const blob = await fetchFile(only);
        triggerDownload(blob, `${photos[0].category ?? "photo"}.jpg`);
        logDownload(1, "single");
        setDownloadingAll(false);
        return;
      }
      if (!target) return;
      const result = await writeZip(
        target,
        photos.map((p, k) => ({
          name: `${String(k + 1).padStart(3, "0")}-${p.category ?? "photo"}.jpg`,
          url: fresh?.photos?.[k] ?? p.downloadUrl,
        })),
        {
          baseName: `${safeTitle}-photos`,
          onProgress: (pr) => setDlProgress(pr.total ? Math.round((pr.done / pr.total) * 100) : 0),
        }
      );
      // Never let photos go missing silently.
      if (!result.ok) {
        setDlError(result.error);
        setZipFailed(true);
      } else {
        if (result.failed) {
          setDlError(`${result.failed} photo${result.failed === 1 ? "" : "s"} couldn't be added. Refresh the page and download again to collect them.`);
        }
        logDownload(result.written, "zip");
        setDlProgress(100);
      }
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => { setDownloadingAll(false); setDlProgress(0); }, 600);
    }
  }, [downloadingAll, photos, title, logDownload, freshUrls, fetchFile]);

  // Call straight from the click: the folder picker needs it.
  const savePhotosSeparately = useCallback(async () => {
    if (downloadingAll || photos.length === 0) return;
    const folder = await openFolderTarget(`${title} – Photos`);
    if (folder.kind === "cancelled") return;
    if (folder.kind === "unsupported") return downloadAllPhotos();
    setDownloadingAll(true);
    setDlProgress(0);
    setDlError("");
    setZipFailed(false);
    setSepLabel("Preparing…");
    const ctl = new AbortController();
    sepAbort.current = ctl;
    try {
      const fresh = await freshUrls();
      const res = await saveToFolder(
        folder,
        photos.map((p, k) => ({
          name: `${String(k + 1).padStart(3, "0")} ${p.category ?? "Photo"}.jpg`,
          url: fresh?.photos?.[k] ?? p.downloadUrl,
        })),
        {
          signal: ctl.signal,
          onProgress: (pr) => {
            setDlProgress(pr.total ? Math.round((pr.done / pr.total) * 100) : 0);
            setSepLabel(`${pr.done} of ${pr.total}`);
          },
        }
      );
      if (res.written > 0) logDownload(res.written, "single");
      if (res.fallback) setDlError("That folder couldn't be written to — use Download instead.");
      else if (!res.cancelled && res.written === 0) setDlError("The photos couldn't be downloaded — please refresh the page and try again.");
      else if (!res.cancelled && res.failed) setDlError(`Saved ${res.written} photos to ${folder.path}; ${res.failed} couldn't be downloaded. Refresh the page and download ${res.failed === 1 ? "it" : "them"} on ${res.failed === 1 ? "its" : "their"} own.`);
    } finally {
      sepAbort.current = null;
      setSepLabel(null);
      setDownloadingAll(false);
      setDlProgress(0);
    }
  }, [downloadingAll, photos, title, logDownload, freshUrls, downloadAllPhotos]);

  const hasVideo = videos.length > 0;
  const [view, setView] = useState<"slideshow" | "grid" | "video">(
    initialPhotos.length === 0 && initialVideos.length > 0 ? "video" : "slideshow"
  );
  const [current, setCurrent] = useState(0);
  const [outgoing, setOutgoing] = useState<number | null>(null);
  const [incomingReady, setIncomingReady] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [showThumbs, setShowThumbs] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const logged = useRef(false);

  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    fetch(`/api/g/${slug}/view`, { method: "POST" }).catch(() => {});
  }, [slug]);

  // "…/g/slug#video" opens straight on the Video tab.
  useEffect(() => {
    if (window.location.hash.toLowerCase() === "#video" && hasVideo) setView("video");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goTo = useCallback((i: number) => {
    setCurrent((cur) => {
      if (i === cur) return cur;
      setOutgoing(cur);
      setIncomingReady(false);
      return i;
    });
  }, []);

  const next = useCallback(() => {
    setCurrent((c) => {
      const n = slides.length ? (c + 1) % slides.length : 0;
      if (n !== c) {
        setOutgoing(c);
        setIncomingReady(false);
      }
      return n;
    });
  }, [slides.length]);

  const prev = useCallback(() => {
    setCurrent((c) => {
      const n = slides.length ? (c - 1 + slides.length) % slides.length : 0;
      if (n !== c) {
        setOutgoing(c);
        setIncomingReady(false);
      }
      return n;
    });
  }, [slides.length]);

  // Fade the incoming slide in
  useEffect(() => {
    if (incomingReady) return;
    const id = requestAnimationFrame(() => setIncomingReady(true));
    return () => cancelAnimationFrame(id);
  }, [incomingReady, current]);

  // Drop the outgoing slide once the fade finishes
  useEffect(() => {
    if (incomingReady && outgoing !== null) {
      const t = setTimeout(() => setOutgoing(null), 1300);
      return () => clearTimeout(t);
    }
  }, [incomingReady, outgoing]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Arrow keys seek a playing video — don't page the hidden slideshow too.
      if (view === "video") return;
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, view]);

  useEffect(() => {
    if (!playing || slides.length < 2 || view !== "slideshow") return;
    const t = setInterval(next, 4000);
    return () => clearInterval(t);
  }, [playing, next, slides.length, view]);

  // Ask for slide-size links just ahead of the viewer (3 back, 8 ahead; the
  // gallery loops, so wrap around).
  useEffect(() => {
    if (!slides.length) return;
    const ids: string[] = [];
    for (let k = -3; k <= 8; k++) {
      const s = slides[(current + k + slides.length) % slides.length];
      if (s && !ids.includes(s.id)) ids.push(s.id);
    }
    if (ids.length) want(ids, "full");
  }, [current, slides, want]);

  // Tile links once the filmstrip or grid is opened: chunks of 60, in order.
  const allPhotoIds = useMemo(() => initialPhotos.map((p) => p.id), [initialPhotos]);
  useEffect(() => {
    if (view === "grid" || showThumbs) want(allPhotoIds, "thumb");
  }, [view, showThumbs, allPhotoIds, want]);

  // Warm the neighbouring photographs so paging feels instant.
  useEffect(() => {
    [current - 1, current + 1].forEach((i) => {
      const idx = slides.length ? (i + slides.length) % slides.length : -1;
      const s = slides[idx];
      if (s && s.url) {
        const img = new window.Image();
        img.decoding = "async";
        // A neighbour failing on old links re-signs before the viewer gets there.
        img.onerror = () => onMediaError();
        img.src = s.url;
      }
    });
  }, [current, slides, onMediaError]);

  if (slides.length === 0 && !hasVideo) {
    return (
      <div className="min-h-screen bg-ink-50 flex items-center justify-center px-6 text-center">
        <div>
          <p className="label-caps text-accent-700">YachtPics</p>
          <p className="text-ink-500 text-sm mt-3">This gallery doesn&apos;t have any photos yet.</p>
        </div>
      </div>
    );
  }

  const slide = slides[current] as Slide | undefined;
  const outSlide = outgoing !== null ? slides[outgoing] : null;
  const caption = slide?.category ?? "";

  const tabClass = (active: boolean) =>
    `text-xs font-medium px-3 min-h-[44px] sm:min-h-0 sm:py-1.5 rounded-[6px] transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
      active ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-900"
    }`;

  const arrowClass =
    "absolute top-1/2 -translate-y-1/2 z-[2] flex h-11 w-11 items-center justify-center rounded-full " +
    "border border-hairline bg-white text-ink-700 text-2xl leading-none shadow-elev-1 " +
    "hover:bg-ink-50 hover:text-ink-950 transition-colors duration-base ease-quiet " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500";

  return (
    <div className="min-h-screen bg-ink-50 flex flex-col">
      {/* Header — one hairline between the gallery and its photographs */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-hairline gap-4">
        <div className="min-w-0">
          <p className="label-caps text-accent-700">YachtPics</p>
          <h1 className="text-ink-900 font-semibold text-base sm:text-lg truncate mt-0.5">{title}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {downloadsEnabled && photos.length > 0 && (
            <button
              onClick={useFolder ? savePhotosSeparately : downloadAllPhotos}
              disabled={downloadingAll}
              title={useFolder ? "Pick a folder — the photos are saved straight into it" : undefined}
              className="text-xs font-medium px-3 min-h-[44px] rounded-ctl border border-accent-500 bg-accent-500 text-white shadow-elev-1 hover:bg-accent-600 disabled:opacity-60 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              {sepLabel ?? (downloadingAll ? (useFolder ? `Saving… ${dlProgress}%` : `Zipping… ${dlProgress}%`) : videos.length > 0 ? "⤓ Download photos" : "⤓ Download all")}
            </button>
          )}
          {downloadsEnabled && useFolder && (sepLabel !== null ? (
            <button
              onClick={() => sepAbort.current?.abort()}
              className="text-xs font-medium px-3 min-h-[44px] rounded-ctl border border-hairline bg-white text-ink-600 shadow-elev-1 hover:text-ink-900 transition-colors duration-base ease-quiet"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={downloadAllPhotos}
              disabled={downloadingAll}
              className="text-xs text-ink-500 hover:text-ink-900 underline underline-offset-2 px-1 min-h-[44px] disabled:opacity-60"
            >
              or as a .zip
            </button>
          ))}
          {slides.length > 1 && view === "slideshow" && (
            <button
              onClick={() => setPlaying((p) => !p)}
              className="text-xs font-medium px-3 min-h-[44px] rounded-ctl border border-hairline bg-white text-ink-600 shadow-elev-1 hover:text-ink-900 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
          )}
          <div className="flex items-center gap-1 rounded-ctl border border-hairline bg-white p-1 shadow-elev-1">
            {slides.length > 0 && (
              <>
                <button onClick={() => setView("slideshow")} className={tabClass(view === "slideshow")}>
                  Slideshow
                </button>
                <button onClick={() => setView("grid")} className={tabClass(view === "grid")}>
                  All Photos
                </button>
              </>
            )}
            {hasVideo && (
              <button onClick={() => setView("video")} className={tabClass(view === "video")}>
                Video
              </button>
            )}
          </div>
        </div>
      </div>

      {dlError && (
        <div className="mx-4 sm:mx-6 mt-3 bg-warn-50 border border-warn-200 text-warn-800 text-sm px-4 py-3 rounded-ctl flex items-start justify-between gap-3">
          <span>
            {dlError}
            {zipFailed && canFolder && photos.length > 1 && (
              <>
                {" "}
                <button onClick={savePhotosSeparately} className="underline underline-offset-2 font-medium text-warn-900 hover:text-ink-900">
                  Save to a folder instead
                </button>
              </>
            )}
          </span>
          <button onClick={() => setDlError("")} className="shrink-0 font-bold text-warn-700 hover:text-warn-800" aria-label="Dismiss">×</button>
        </div>
      )}

      {downloadsEnabled && useFolder && (
        <div className="mx-4 sm:mx-6">
          <FolderDownloadHint show />
        </div>
      )}

      {downloadsClosedNote && (
        <p className="mx-4 sm:mx-6 mt-3 text-sm text-ink-500">
          {downloadsClosedNote}
          {contact?.email && (
            <>
              {" "}
              <a href={`mailto:${contact.email}`} className="text-accent-700 hover:text-accent-600 transition-colors duration-fast">{contact.email}</a>
            </>
          )}
        </p>
      )}

      {view === "video" ? (
        <VideoStack
          videos={videos.map((v, i) => ({ key: v.id ?? String(i), url: v.url, posterUrl: v.posterUrl ?? null, label: videoLabel(null, v.filename) }))}
          onError={onMediaError}
          extra={downloadsEnabled ? (_v, i) => (
            <button
              onClick={() => downloadVideo(i)}
              disabled={downloadingOne}
              aria-label="Download this video"
              className="shrink-0 flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900 disabled:opacity-50 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 rounded"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
              </svg>
              {downloadingOne ? "…" : "Download"}
            </button>
          ) : undefined}
        />
      ) : view === "slideshow" && slide ? (
        <>
          {/* Main slide — a print on paper: the photograph claims the stage, lifted by its shadow */}
          <div
            className="flex-1 relative select-none overflow-hidden"
            style={{ minHeight: "calc(100vh - 240px)" }}
            onTouchStart={(e) => setTouchStart(e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (touchStart === null) return;
              const d = touchStart - e.changedTouches[0].clientX;
              if (Math.abs(d) > 50) (d > 0 ? next() : prev());
              setTouchStart(null);
            }}
          >
            {/* Outgoing photo (stays underneath while the new one fades in) */}
            {outSlide && (outSlide.url ?? outSlide.thumbUrl) && (
              <div
                key={`out-${outgoing}`}
                className="absolute inset-0 flex items-center justify-center p-2 sm:p-5"
                style={{
                  zIndex: 0,
                  opacity: incomingReady ? 0 : 1,
                  // A true cross-dissolve — both photos move together over the same
                  // window, so a wide shot's wings dissolve away with the frame
                  // instead of sitting either side of a tall one and winking out.
                  transition: "opacity 1200ms cubic-bezier(0.25, 0, 0.15, 1)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={(outSlide.url ?? outSlide.thumbUrl)!}
                  alt=""
                  decoding="sync"
                  className="max-h-full max-w-full object-contain rounded-[2px] shadow-print"
                />
              </div>
            )}

            {/* Current slide */}
            <div
              key={`in-${current}`}
              className="absolute inset-0 flex items-center justify-center p-2 sm:p-5"
              style={{ zIndex: 1 }}
            >
              {/* Until the slide-size link arrives, show the tile copy if we have one. */}
              {(slide.url ?? slide.thumbUrl) && (
              <FadePhoto
                src={(slide.url ?? slide.thumbUrl)!}
                alt={altFor(slide.category)}
                eager
                retries={3}
                onError={onMediaError}
                className="max-h-full max-w-full object-contain rounded-[2px] shadow-print"
              />
              )}
            </div>

            {slides.length > 1 && (
              <>
                <button onClick={prev} aria-label="Previous" className={`${arrowClass} left-3`}>
                  ‹
                </button>
                <button onClick={next} aria-label="Next" className={`${arrowClass} right-3`}>
                  ›
                </button>
              </>
            )}
          </div>

          {/* Caption + counter, with a filmstrip toggle */}
          <div className="flex items-center justify-center gap-3 pt-2 pb-1.5 px-4">
            <p className="label-caps text-ink-600">
              {caption ? `${caption} · ` : ""}
              {current + 1} / {slides.length}
            </p>
            {slides.length > 1 && (
              <button
                onClick={() => setShowThumbs((v) => !v)}
                aria-label={showThumbs ? "Hide thumbnails" : "Show thumbnails"}
                aria-pressed={showThumbs}
                className={`flex h-6 w-6 items-center justify-center rounded transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${showThumbs ? "text-ink-800" : "text-ink-400 hover:text-ink-700"}`}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <rect x="2" y="6" width="4" height="8" rx="1" />
                  <rect x="8" y="6" width="4" height="8" rx="1" />
                  <rect x="14" y="6" width="4" height="8" rx="1" />
                </svg>
              </button>
            )}
            {downloadsEnabled && (
              <button
                onClick={() => downloadCurrentSlide(slide, current)}
                disabled={downloadingOne}
                aria-label="Download this photo"
                className="flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900 disabled:opacity-50 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 rounded"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
                </svg>
                {downloadingOne ? "…" : "Download"}
              </button>
            )}
          </div>

          {/* Thumbnail strip — hidden by default so the photograph claims the space; toggle to reveal */}
          {showThumbs && (
          <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto scrollbar-hide">
            {slides.map((s, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === current}
                className={`shrink-0 overflow-hidden transition-opacity duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                  i === current ? "opacity-100 ring-1 ring-accent-500" : "opacity-50 hover:opacity-100"
                }`}
              >
                {!(s.thumbUrl ?? s.url) ? (
                  // Link still on its way — a quiet paper square, not a broken image.
                  <div className="w-[70px] h-11 bg-ink-100" />
                ) : (
                  <RetryImg
                    src={(s.thumbUrl ?? s.url)!}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={onMediaError}
                    className="w-[70px] h-11 object-cover"
                  />
                )}
              </button>
            ))}
          </div>
          )}
        </>
      ) : (
        /* Grid view — a gallery wall on paper: prints on white mats, lifted by their shadows */
        <div className="flex-1 px-3 sm:px-5 py-4 overflow-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4 max-w-5xl mx-auto">
            {slides.map((s, i) => (
              <button
                key={i}
                onClick={() => { setView("slideshow"); goTo(i); }}
                aria-label={`Open slide ${i + 1}`}
                className="aspect-[4/3] relative overflow-hidden rounded-[2px] bg-white shadow-print focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50"
              >
                {(s.thumbUrl ?? s.url) && (
                  <FadePhoto
                    src={(s.thumbUrl ?? s.url)!}
                    alt={altFor(s.category)}
                    eager={i < 4}
                    retries={6}
                    onError={onMediaError}
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* YachtPics credit — the last line of the page */}
      <PresentedThrough className="py-4" />
    </div>
  );
}
