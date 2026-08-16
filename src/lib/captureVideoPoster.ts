/**
 * Grab a still frame from a video file, in the browser, before it's uploaded.
 *
 * A listing can be created with video and no photos, and the listings index
 * resolves its cover image server-side from stored files — it can't afford to
 * download a video per row just to show frame one. So we capture a still once,
 * at upload time, and store it alongside the video.
 *
 * Deliberately forgiving: if the browser can't decode the file, the seek never
 * lands, or the canvas is tainted, this resolves to null. A missing cover image
 * is a cosmetic problem; a video that refuses to upload is not. Callers should
 * treat null as "no poster" and carry on.
 */

/** How far into the video to grab the frame. Frame zero is very often black. */
const SEEK_SECONDS = 1.0;

/** Longest we'll wait on a browser that never fires the events we need. */
const TIMEOUT_MS = 10_000;

/** Cap on the stored still — plenty for a cover tile, tiny to fetch. */
const MAX_EDGE = 1280;

export async function captureVideoPoster(file: File): Promise<Blob | null> {
  if (typeof document === "undefined") return null;

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");

  try {
    return await new Promise<Blob | null>((resolve) => {
      let settled = false;
      const finish = (result: Blob | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeAttribute("src");
        video.load();
        resolve(result);
      };

      const timer = setTimeout(() => finish(null), TIMEOUT_MS);

      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      // Local blob URL, but this keeps the canvas untainted either way.
      video.crossOrigin = "anonymous";

      video.onerror = () => finish(null);

      video.onloadedmetadata = () => {
        // Short clips: don't seek past the end, just take what's there.
        const target = Math.min(SEEK_SECONDS, Math.max(0, (video.duration || 0) / 2));
        try {
          video.currentTime = Number.isFinite(target) ? target : 0;
        } catch {
          finish(null);
        }
      };

      video.onseeked = () => {
        try {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) return finish(null);

          const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);

          const ctx = canvas.getContext("2d");
          if (!ctx) return finish(null);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.82);
        } catch {
          finish(null);
        }
      };

      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
