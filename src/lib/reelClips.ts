/**
 * Video clips in a reel.
 *
 * A reel can carry a few short, muted clips alongside its photographs — two to
 * four seconds each, three at most (two on a phone). Everything here runs in
 * the browser with mediabunny, the same library that encodes the reel:
 *
 *   • probeClip      — when "Add to reel" is pressed: open the video, check the
 *                      browser can decode it, read one frame at the in-point.
 *                      A clip that can't be read fails HERE, with a clear
 *                      message, never halfway through a render.
 *   • openClipReader — at render time: one reader per clip, handing out the
 *                      frame for "t seconds into the clip" in lockstep with the
 *                      render loop. Frames are decoded as the loop asks for
 *                      them; a clip is never decoded whole into memory.
 *
 * A listing's videos live on Cloudflare R2 and are read with HTTP range
 * requests (UrlSource), so only the bytes around the chosen few seconds are
 * fetched. A video picked off the device in the Studio is read straight from
 * the file (BlobSource). No audio is ever read.
 */

import type { InputVideoTrack, WrappedCanvas, Input, CanvasSink } from "mediabunny";

/** Where a clip's bytes come from: a signed URL (R2) or a local file. */
export type ClipSource = { url: string } | { blob: Blob };

export type ClipLength = 2 | 3 | 4;
export const CLIP_LENGTHS: ClipLength[] = [2, 3, 4];
export const CLIP_DEFAULT_LENGTH: ClipLength = 3;
/** Clips per reel. A phone gets fewer — each clip holds a decoder open. */
export const CLIP_MAX = 3;
export const CLIP_MAX_PHONE = 2;

/** Selection ids for clips start with this, so they can't collide with photo ids. */
export const CLIP_ID_PREFIX = "clip:";
export function isClipId(id: string): boolean {
  return id.indexOf(CLIP_ID_PREFIX) === 0;
}

export const CLIP_ERR_NETWORK =
  "This video can’t be read by the browser yet — the video storage needs one setting (admin: run the R2 self-test).";
export const CLIP_ERR_CODEC =
  "This clip’s format can’t be decoded in this browser. Re-export it as H.264 or record in ‘Most compatible’.";

export class ClipError extends Error {
  kind: "network" | "codec";
  constructor(kind: "network" | "codec") {
    super(kind === "network" ? CLIP_ERR_NETWORK : CLIP_ERR_CODEC);
    this.kind = kind;
  }
}

/**
 * Turn whatever went wrong into one of the two messages a person can act on.
 * Over a URL, anything that isn't plainly a decoding problem is the storage's
 * CORS / range setting (the browser hides the real reason from the page). A
 * local file has no network in the way, so its failures are the format's.
 */
function classify(err: unknown, overUrl: boolean): ClipError {
  if (err instanceof ClipError) return err;
  const msg = (err instanceof Error ? `${err.name} ${err.message}` : String(err)).toLowerCase();
  if (overUrl && /fetch|network|cors|range|content-length|content-range|status|http|load failed/.test(msg)) {
    return new ClipError("network");
  }
  if (/decod|codec|unsupported|not supported|encodingerror|format/.test(msg)) return new ClipError("codec");
  return new ClipError(overUrl ? "network" : "codec");
}

type Mb = typeof import("mediabunny");

function makeInput(mb: Mb, src: ClipSource): Input {
  const source = "url" in src
    ? new mb.UrlSource(src.url, {
        // A few MB either side of the chosen seconds is all a clip needs.
        maxCacheSize: 16 * 1024 * 1024,
        // Two quick retries, then give up: the default retries forever unless
        // it suspects CORS, and a probe must answer rather than hang.
        getRetryDelay: (previousAttempts: number) => (previousAttempts < 2 ? 0.5 : null),
      })
    : new mb.BlobSource(src.blob);
  return new mb.Input({ formats: mb.ALL_FORMATS, source });
}

/** Open the primary video track and make sure this browser can decode it. */
async function openTrack(input: Input, overUrl: boolean): Promise<InputVideoTrack> {
  if (!(await input.canRead())) throw new ClipError(overUrl ? "network" : "codec");
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new ClipError("codec");
  if (!(await track.canDecode())) throw new ClipError("codec");
  return track;
}

/**
 * Pick-time check: can this browser read and decode this video, at this
 * in-point? Resolves with the video's length and a small poster of the frame
 * at the in-point (for the picker tile); rejects with a ClipError whose
 * message is the one to show.
 */
export async function probeClip(src: ClipSource, inSec: number): Promise<{ durationSec: number | null; posterUrl: string | null }> {
  const overUrl = "url" in src;
  const mb = await import("mediabunny");
  const input = makeInput(mb, src);
  try {
    const track = await openTrack(input, overUrl);
    const first = await input.getFirstTimestamp([track]);
    let durationSec: number | null = null;
    try {
      const end = (await input.getDurationFromMetadata([track])) ?? (await input.computeDuration([track]));
      durationSec = Math.max(0, end - first);
    } catch { durationSec = null; }
    const vw = await track.getDisplayWidth();
    const vh = await track.getDisplayHeight();
    const sc = Math.min(1, 320 / Math.max(1, vw, vh));
    const sink = new mb.CanvasSink(track, { width: Math.max(2, Math.round(vw * sc)), height: Math.max(2, Math.round(vh * sc)), fit: "fill" });
    const frame = await sink.getCanvas(first + Math.max(0, inSec));
    if (!frame) throw new ClipError("codec");
    let posterUrl: string | null = null;
    const c = frame.canvas;
    if (typeof HTMLCanvasElement !== "undefined" && c instanceof HTMLCanvasElement) {
      try { posterUrl = c.toDataURL("image/jpeg", 0.75); } catch { posterUrl = null; }
    }
    return { durationSec, posterUrl };
  } catch (err) {
    throw classify(err, overUrl);
  } finally {
    input.dispose();
  }
}

/**
 * One clip, open for a render.
 *
 * `advance(local)` moves the reader to `local` seconds into the clip (clamped
 * to the clip's own length) and `frame()` is then the frame on screen at that
 * moment. Frames come from CanvasSink.canvases() — a sequential decode that
 * pre-decodes only a few frames ahead — walked forward one output frame at a
 * time, so memory stays at a handful of frame-sized canvases per clip however
 * long the source video is. Once the clip has passed, the render loop calls
 * `release()` and the decoder, the cache and the canvases go with it.
 *
 * A decode failure mid-render never throws: the reader marks itself failed
 * and keeps showing the last frame it had (or the poster), so a bad clip
 * freezes rather than killing the film.
 */
export type ClipReader = {
  /** The frame at the in-point, as a bitmap: the fallback frame and the source of the blurred backdrop. */
  poster: ImageBitmap;
  frame(): HTMLCanvasElement | OffscreenCanvas | null;
  advance(local: number): Promise<void>;
  release(): void;
  readonly failed: boolean;
};

/**
 * Open a clip for rendering. `box` is the rectangle the clip will be drawn
 * into and `cover` whether it fills it (crop) or sits whole inside it; the
 * decoded frames are sized to exactly what that needs, never larger than the
 * video itself.
 */
export async function openClipReader(
  clip: { open: () => Promise<ClipSource>; inSec: number; lengthSec: number },
  box: { w: number; h: number; cover: boolean },
): Promise<ClipReader> {
  const src = await clip.open();
  const overUrl = "url" in src;
  const mb = await import("mediabunny");
  const input = makeInput(mb, src);
  let sink: CanvasSink;
  let start: number;
  let poster: ImageBitmap;
  try {
    const track = await openTrack(input, overUrl);
    const vw = await track.getDisplayWidth();
    const vh = await track.getDisplayHeight();
    const first = await input.getFirstTimestamp([track]);
    start = first + Math.max(0, clip.inSec);
    const fitScale = box.cover
      ? Math.max(box.w / vw, box.h / vh)
      : Math.min(box.w / vw, box.h / vh);
    const sc = Math.min(1, fitScale);
    sink = new mb.CanvasSink(track, {
      width: Math.max(2, Math.round(vw * sc)),
      height: Math.max(2, Math.round(vh * sc)),
      fit: "fill", // same aspect as the video, so nothing is stretched
      // A ring of four canvases: the frame on screen, the next one, and room
      // for the one being written. Constant memory for the life of the clip.
      poolSize: 4,
    });
    const f0 = await sink.getCanvas(start);
    if (!f0) throw new ClipError("codec");
    poster = await createImageBitmap(f0.canvas);
  } catch (err) {
    input.dispose();
    throw classify(err, overUrl);
  }

  const end = start + clip.lengthSec;
  let iter: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  let current: WrappedCanvas | null = null;
  let pending: WrappedCanvas | null = null;
  let exhausted = false;
  let failed = false;
  let released = false;

  return {
    poster,
    get failed() { return failed; },
    frame() { return released ? null : current ? current.canvas : null; },
    async advance(local: number) {
      if (failed || released) return;
      const ts = start + Math.max(0, Math.min(local, clip.lengthSec - 0.001));
      try {
        if (!iter) {
          iter = sink.canvases(start, end);
          const r = await iter.next();
          pending = r.done ? null : r.value;
          if (!pending) exhausted = true;
        }
        while (pending && pending.timestamp <= ts + 1e-4) {
          current = pending;
          if (exhausted) break;
          const r = await iter.next();
          pending = r.done ? null : r.value;
          if (!pending) exhausted = true;
        }
        // The first decoded frame can sit a hair after the in-point.
        if (!current && pending) current = pending;
      } catch {
        failed = true;
      }
    },
    release() {
      if (released) return;
      released = true;
      if (iter) { iter.return(undefined).catch(() => {}); iter = null; }
      current = null;
      pending = null;
      try { input.dispose(); } catch { /* already gone */ }
    },
  };
}

/**
 * Is this a phone? Read from the user agent, not the viewport — a Galaxy Z
 * Fold's inner screen is wider than a small laptop's. Same rule the Reel
 * Studio uses for its photo budget.
 */
export function detectPhone(): { mobile: boolean; mem: number } {
  if (typeof navigator === "undefined") return { mobile: false, mem: 8 };
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const ua = nav.userAgent || "";
  const mobile = nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
    || (typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches && window.innerWidth < 1100);
  const mem = nav.deviceMemory ?? (mobile ? 4 : 8);
  return { mobile, mem };
}
