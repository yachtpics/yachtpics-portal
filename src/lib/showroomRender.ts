/**
 * Showroom Loop (Oct 15) — the render engine. Browser only.
 *
 * One long 1920×1080 H.264 MP4 at 30 fps for a brokerage's office monitor:
 *   opening card (logo) → boat 1's photos → … → boat N's photos → closing card.
 * The closing card is drawn exactly like the opening card and both are still,
 * so a monitor set to repeat loops through the card without a visible seam.
 *
 *   • Photos: a slow Ken Burns move (push in, drift right, pull out, drift
 *     left, in turn — 6% over the photo's time). Landscape fills the frame;
 *     portrait sits whole over a blurred, dimmed copy of itself (no bars).
 *   • 1 s crossfade between photos of a boat; between boats a 1.5 s dip
 *     through black (or a 1.5 s crossfade). Cards crossfade in and out (1 s).
 *   • Each boat's first photo carries its title (the Editorial reel look:
 *     serif caps, gold rule, spec line in the portal sans), faded in and out.
 *   • The logo sits small in a corner over every photo.
 *
 * Memory stays flat however long the loop is: frames go straight to the
 * encoder (mediabunny CanvasSource — ReelMaker's path), only the photos on
 * screen plus the next few are decoded (≤ 2400 px, a pool of two decoding at
 * once), each bitmap is closed as soon as it has played, and where the
 * browser has the Origin Private File System the MP4 streams to a file on
 * disk instead of memory.
 *
 * Music (optional): reelMusic is built for reel-length tracks (one intro, one
 * build, one cadence onto an end card). A multi-minute loop is therefore
 * scored as one short track PER BOAT — composed just before that boat plays,
 * with the boat's photo changes as its cut points and the cadence landing as
 * the boat dips out — and consecutive tracks are crossfaded over 1 s. Each
 * track is levelled by reelMusic itself (the same −14 LUFS target).
 */
import { composeReelMusic, MUSIC_SAMPLE_RATE, musicCanCompose, type MusicMood } from "@/lib/reelMusic";
import { REEL_STYLES, rgba } from "@/lib/reelStyles";
import { fillTrackedCentered, trackedWidth, wrapTracked } from "@/lib/canvasText";

export type ShowroomResolution = "1080" | "4k";

/**
 * Per-resolution settings. Everything drawn scales with the frame height
 * (sc = H / 1080), so 4K is the 1080p picture at twice the detail.
 *   • bitrate — slow photo motion compresses well; these are targets for a
 *     variable-bitrate encoder, so real files usually come in smaller.
 *   • photoEdge — longest side photos are decoded at: cover + the 6% Ken
 *     Burns zoom needs ≈ 1.06 × frame width (2035 px at 1080p, 4070 at 4K).
 *   • lookahead / pool — how many photos are decoded ahead, and at once. A
 *     4K photo bitmap is ~50 MB (plus the original while it decodes), so 4K
 *     keeps two ahead and decodes one at a time.
 *   • warnSec — the page asks before starting a loop longer than this.
 */
export const SHOWROOM_SIZES: Record<ShowroomResolution, {
  w: number; h: number; bitrate: number; photoEdge: number; lookahead: number; pool: number; warnSec: number; label: string;
}> = {
  "1080": { w: 1920, h: 1080, bitrate: 12_000_000, photoEdge: 2400, lookahead: 3, pool: 2, warnSec: 15 * 60, label: "1080p" },
  "4k": { w: 3840, h: 2160, bitrate: 35_000_000, photoEdge: 4400, lookahead: 2, pool: 1, warnSec: 8 * 60, label: "4K" },
};
/** Largest file a FAT32 USB stick can hold (4 GiB − 1 byte). */
export const FAT32_MAX_BYTES = 4 * 1024 ** 3 - 1;
const AUDIO_BITRATE_EST = 192_000;

/** Upper estimate of the MP4's size (the encoder is variable-bitrate; most loops come in under this). */
export function estimateShowroomBytes(seconds: number, res: ShowroomResolution, music: boolean): number {
  return Math.round((seconds * (SHOWROOM_SIZES[res].bitrate + (music ? AUDIO_BITRATE_EST : 0))) / 8 * 1.01);
}

/** "850 MB" / "3.4 GB". */
export function formatBytes(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`;
}
export const SHOWROOM_FPS = 30;
/** Photo-to-photo crossfade, and card in/out. */
export const SHOWROOM_XFADE = 1;
/** Boat-to-boat transition (dip through black, or a crossfade). */
export const SHOWROOM_BOAT_GAP = 1.5;
export const SHOWROOM_CARD_SEC = 5;
const MUSIC_XFADE = 1;
const OPFS_NAME = "showroom-render.mp4";

export type LogoCorner = "br" | "bl" | "tr" | "tl";
export type BoatTransition = "dip" | "crossfade";

export type ShowroomSlide = {
  /** Which boat (index into the boats in play order). */
  boat: number;
  /** Fetches and decodes the photo (any size; it is downscaled here). */
  load: () => Promise<ImageBitmap>;
  /** Set on a boat's first photo. */
  title?: { name: string; line: string };
};

export type ShowroomItem = {
  kind: "card" | "photo";
  slide: number; // -1 for cards
  start: number;
  dur: number;
  /** Seconds of fade-in at the start (over whatever is underneath). */
  fadeIn: number;
  /** Seconds of fade-to-black at the end (dip). */
  fadeOut: number;
};

/**
 * The loop's timeline. `boats[i]` = how many photos boat i has. Photos start
 * `hold` seconds apart; a crossfade overlaps the next photo onto the end of
 * this one, a dip fades this one to black and the next one up from it.
 */
export function showroomTimeline(boats: number[], hold: number, transition: BoatTransition): { items: ShowroomItem[]; total: number } {
  const items: ShowroomItem[] = [];
  items.push({ kind: "card", slide: -1, start: 0, dur: SHOWROOM_CARD_SEC, fadeIn: 0, fadeOut: 0 });
  let t = SHOWROOM_CARD_SEC - SHOWROOM_XFADE; // where the next item starts
  let slide = 0;
  boats.forEach((n, b) => {
    for (let j = 0; j < n; j++) {
      const prev = items[items.length - 1];
      let fadeIn = SHOWROOM_XFADE;
      let start = t;
      if (j === 0 && b > 0) {
        if (transition === "dip") {
          prev.fadeOut = SHOWROOM_BOAT_GAP / 2;
          start = prev.start + prev.dur;
          fadeIn = SHOWROOM_BOAT_GAP / 2;
        } else {
          start = prev.start + prev.dur - SHOWROOM_BOAT_GAP;
          fadeIn = SHOWROOM_BOAT_GAP;
        }
      }
      // Long enough to be on screen `hold` seconds, plus the overlap the next item lays over it.
      items.push({ kind: "photo", slide, start, dur: hold + SHOWROOM_XFADE, fadeIn, fadeOut: 0 });
      t = start + hold;
      slide++;
    }
  });
  const last = items[items.length - 1];
  // A crossfade between boats needs the outgoing photo to run under the whole 1.5 s.
  if (transition === "crossfade") {
    for (let i = 1; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "photo" && it.fadeIn === SHOWROOM_BOAT_GAP) {
        const p = items[i - 1];
        p.dur = Math.max(p.dur, it.start + SHOWROOM_BOAT_GAP - p.start);
      }
    }
  }
  const cStart = last.kind === "card" ? last.start + last.dur : last.start + last.dur - SHOWROOM_XFADE;
  items.push({ kind: "card", slide: -1, start: cStart, dur: SHOWROOM_CARD_SEC, fadeIn: SHOWROOM_XFADE, fadeOut: 0 });
  return { items, total: cStart + SHOWROOM_CARD_SEC };
}

/** "4:12" / "1:02:05". */
export function formatRunTime(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** Load a logo (PNG, JPEG, WebP, SVG — URL or uploaded file) as a bitmap ≤ 2400 px (big enough for a 4K card). */
export async function loadLogoBitmap(src: string | Blob): Promise<ImageBitmap> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("The logo couldn’t be loaded.")); img.src = url; });
    const w0 = img.naturalWidth || 1200, h0 = img.naturalHeight || 600;
    const k = Math.min(1, 2400 / Math.max(w0, h0)) || 1;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const bmp = await createImageBitmap(c);
    c.width = 0; c.height = 0;
    return bmp;
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

/** Fetch an image and decode it no larger than `maxEdge` on its long side. */
export async function fetchBitmap(url: string, maxEdge = 2400): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Photo fetch failed (${res.status}).`);
  const blob = await res.blob();
  const probe = await createImageBitmap(blob);
  const long = Math.max(probe.width, probe.height);
  if (long <= maxEdge) return probe;
  const k = maxEdge / long;
  const w = Math.round(probe.width * k), h = Math.round(probe.height * k);
  try {
    const out = await createImageBitmap(probe, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
    probe.close();
    return out;
  } catch {
    // No resize options (older Safari): draw it down ourselves.
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const cx = c.getContext("2d")!;
    cx.imageSmoothingQuality = "high";
    cx.drawImage(probe, 0, 0, w, h);
    probe.close();
    const out = await createImageBitmap(c);
    c.width = 0; c.height = 0;
    return out;
  }
}

export type ShowroomRenderOptions = {
  canvas: HTMLCanvasElement;
  resolution: ShowroomResolution;
  slides: ShowroomSlide[];
  /** Photo count per boat, in play order (sums to slides.length). */
  boats: number[];
  holdSec: number;
  transition: BoatTransition;
  logo: ImageBitmap | null;
  corner: LogoCorner;
  /** On the cards when there's no logo (and under it when `tagline` is set). */
  brandName: string;
  /** Optional line under the logo on the cards; empty = none. */
  tagline: string;
  fonts: { serif: string; sans: string };
  music: { mood: MusicMood; seed: number } | null;
  onProgress?: (p: { phase: "preparing" | "rendering" | "finishing"; pct: number }) => void;
  cancelled?: () => boolean;
};

export type ShowroomResult = { file: Blob; seconds: number; notes: string[] };

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ED = REEL_STYLES.editorial;

type Decoded = { bmp: ImageBitmap; backdrop: HTMLCanvasElement | null };

/** Draw a card (also used for the preview thumbnail of the card). */
export function drawShowroomCard(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  o: { logo: ImageBitmap | null; brandName: string; tagline: string; fonts: { serif: string; sans: string } },
) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.08, W / 2, H / 2, W * 0.7);
  g.addColorStop(0, "#14233a");
  g.addColorStop(1, ED.ground);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const sc = H / 1080;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let bottom: number;
  if (o.logo) {
    const k = Math.min((W * 0.46) / o.logo.width, (H * 0.32) / o.logo.height);
    const lw = o.logo.width * k, lh = o.logo.height * k;
    const ly = H / 2 - lh / 2 - (o.tagline ? 36 * sc : 0);
    ctx.drawImage(o.logo, (W - lw) / 2, ly, lw, lh);
    bottom = ly + lh;
  } else {
    ctx.fillStyle = ED.text;
    let size = 84 * sc;
    const name = (o.brandName || "").toUpperCase();
    ctx.font = `600 ${size}px ${o.fonts.serif}`;
    while (trackedWidth(ctx, name, ED.headTrack * 2 * sc) > W * 0.8 && size > 40 * sc) { size -= 4 * sc; ctx.font = `600 ${size}px ${o.fonts.serif}`; }
    const y = H / 2 + size * 0.32 - (o.tagline ? 36 * sc : 0);
    fillTrackedCentered(ctx, name, W / 2, y, ED.headTrack * 2 * sc);
    bottom = y + 10 * sc;
  }
  if (o.tagline) {
    ctx.fillStyle = ED.accent;
    ctx.fillRect(W / 2 - 40 * sc, bottom + 40 * sc, 80 * sc, 2 * sc);
    ctx.fillStyle = ED.soft;
    ctx.font = `500 ${28 * sc}px ${o.fonts.sans}`;
    fillTrackedCentered(ctx, o.tagline.toUpperCase(), W / 2, bottom + 92 * sc, 7 * sc);
  }
}

export async function renderShowroom(o: ShowroomRenderOptions): Promise<ShowroomResult> {
  const spec = SHOWROOM_SIZES[o.resolution];
  const W = spec.w, H = spec.h, FPS = SHOWROOM_FPS;
  const LOOKAHEAD = spec.lookahead, POOL = spec.pool;
  if (!o.slides.length) throw new Error("Pick at least one photo.");
  const notes: string[] = [];
  const { items, total } = showroomTimeline(o.boats, o.holdSec, o.transition);
  const totalFrames = Math.round(total * FPS);
  const canvas = o.canvas;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.imageSmoothingQuality = "high";
  o.onProgress?.({ phase: "preparing", pct: 0 });

  try {
    await Promise.all([
      document.fonts.load(`600 100px ${o.fonts.serif}`),
      ...[500, 600].map((w) => document.fonts.load(`${w} 40px ${o.fonts.sans}`)),
    ]);
    await document.fonts.ready;
  } catch { /* older browser: fall through */ }

  const mb = await import("mediabunny");
  // mediabunny picks the H.264 level from the frame size and bitrate (5.1 at 4K).
  const codec = await mb.getFirstEncodableVideoCodec(["avc"], { width: W, height: H, bitrate: spec.bitrate });
  if (!codec) {
    throw new Error(o.resolution === "4k"
      ? "This computer can’t make 4K video — use 1080p."
      : "This browser can’t encode H.264 video. Use Chrome or Edge on a computer.");
  }

  let music = o.music;
  if (music) {
    let ok = false;
    try { ok = musicCanCompose() && (await mb.canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: MUSIC_SAMPLE_RATE, quality: mb.QUALITY_HIGH })); } catch { ok = false; }
    if (!ok) { music = null; notes.push("This browser can’t add music to a video, so the loop is silent."); }
  }

  // Where the file goes: a file in the browser's private storage when it can, else memory.
  let opfs: FileSystemFileHandle | null = null;
  let fsw: FileSystemWritableFileStream | null = null;
  try {
    const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
    if (typeof storage?.getDirectory === "function") {
      const dir = await storage.getDirectory();
      const handle = await dir.getFileHandle(OPFS_NAME, { create: true });
      if (typeof (handle as FileSystemFileHandle & { createWritable?: unknown }).createWritable === "function") {
        fsw = await handle.createWritable({ keepExistingData: false });
        opfs = handle;
      }
    }
  } catch { opfs = null; fsw = null; }
  if (!opfs) {
    // Without private file storage the whole MP4 is held in memory, and a
    // browser can't hold much more than ~2 GB in one piece.
    if (estimateShowroomBytes(total, o.resolution, !!music) > 1.6e9) {
      try { await fsw?.abort(); } catch { /* none */ }
      throw new Error("This browser can’t hold a video this big in memory. Use Chrome or Edge, pick fewer photos, or use 1080p.");
    }
    if (total > 600) notes.push("Built in memory (this browser has no private file storage); a very long loop may run out of memory.");
  }

  const target = fsw
    ? new mb.StreamTarget(fsw as unknown as WritableStream<import("mediabunny").StreamTargetChunk>, { chunked: true })
    : new mb.BufferTarget();
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: fsw ? "reserve" : "in-memory" }), target });
  const source = new mb.CanvasSource(canvas, { codec: "avc", bitrate: spec.bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: FPS, maximumPacketCount: Math.ceil(totalFrames * 1.34) + 60 });
  const audio = music ? new mb.AudioBufferSource({ codec: "aac", quality: mb.QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio, { maximumPacketCount: Math.ceil((total * MUSIC_SAMPLE_RATE) / 1024 * 1.34) + 200 });
  await output.start();

  // ── Music: one track per boat, crossfaded ──
  // Chunk k spans [starts[k], starts[k+1]) plus MUSIC_XFADE of tail, which is
  // mixed into the head of chunk k+1. Chunk 0 also covers the opening card;
  // the last also covers the closing card and fades out at the very end.
  const firstPhotoOfBoat: number[] = [];
  let si = 0;
  o.boats.forEach((n) => { firstPhotoOfBoat.push(si); si += n; });
  const starts = [0].concat(firstPhotoOfBoat.slice(1).map((s) => items.find((x) => x.slide === s)!.start));
  let nextChunk = 0;
  let carry: Float32Array<ArrayBuffer>[] | null = null; // the previous chunk's tail, to mix into this one's head
  const SR = MUSIC_SAMPLE_RATE;
  const addMusicUpTo = async (t: number) => {
    if (!audio || !music) return;
    while (nextChunk < starts.length && starts[nextChunk] <= t + 1e-6) {
      if (o.cancelled?.()) return;
      const k = nextChunk;
      const lastChunk = k === starts.length - 1;
      const a0 = Math.round(starts[k] * SR);
      const a1 = lastChunk ? Math.round(total * SR) : Math.round(starts[k + 1] * SR);
      const tail = lastChunk ? 0 : Math.round(MUSIC_XFADE * SR);
      const len = a1 - a0 + tail;
      const durSec = len / SR;
      const b0 = starts[k];
      // Cut points: every photo change inside this chunk. The cadence lands as the boat leaves.
      const cuts = items.filter((x) => x.start > b0 + 0.3 && x.start < b0 + durSec - 0.3).map((x) => x.start - b0);
      const leaveAt = lastChunk ? durSec - SHOWROOM_CARD_SEC : durSec - tail / SR - 2.5;
      let chans: Float32Array<ArrayBuffer>[];
      try {
        const buf = await composeReelMusic({ durationSec: durSec, cutTimesSec: cuts, mood: music.mood, seed: (music.seed + k * 7919) >>> 0, endCardStartSec: leaveAt });
        chans = [0, 1].map((c) => { const d = new Float32Array(len); d.set(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)).subarray(0, len)); return d; });
      } catch {
        chans = [new Float32Array(len), new Float32Array(len)];
        const msg = "Part of the music couldn’t be made; that stretch is silent.";
        if (notes.indexOf(msg) < 0) notes.push(msg);
      }
      // Crossfade: the last chunk's tail (already fading out) under this head, which fades in.
      if (carry) {
        const n = Math.min(carry[0].length, len);
        for (let c = 0; c < 2; c++) {
          const d = chans[c], p = carry[c];
          for (let i = 0; i < n; i++) {
            const x = i / n;
            d[i] = d[i] * Math.sin((x * Math.PI) / 2) + p[i] * Math.cos((x * Math.PI) / 2);
          }
        }
      }
      carry = tail ? chans.map((d) => d.slice(len - tail)) : null;
      const body = a1 - a0;
      const out = new AudioBuffer({ length: Math.max(1, body), numberOfChannels: 2, sampleRate: SR });
      out.copyToChannel(chans[0].subarray(0, body), 0);
      out.copyToChannel(chans[1].subarray(0, body), 1);
      await audio.add(out);
      nextChunk++;
      if (nextChunk === starts.length) audio.close();
    }
  };

  // ── Photos: decoded a few ahead (two at a time), closed once played ──
  const decoded = new Map<number, Decoded>();
  const pending = new Map<number, Promise<Decoded | null>>();
  const failed = new Set<number>();
  const makeBackdrop = (bmp: ImageBitmap): HTMLCanvasElement => {
    // The same photo, covering the frame, blurred and dimmed — built once at
    // quarter size and stretched (a blur doesn't need the pixels).
    const bd = document.createElement("canvas");
    bd.width = W / 4; bd.height = H / 4;
    const b = bd.getContext("2d")!;
    const k = Math.max(bd.width / bmp.width, bd.height / bmp.height) * 1.1;
    const dw = bmp.width * k, dh = bmp.height * k;
    if (typeof b.filter === "string") {
      b.filter = `blur(${(9 * H) / 1080}px) saturate(0.9)`;
      b.drawImage(bmp, (bd.width - dw) / 2, (bd.height - dh) / 2, dw, dh);
      b.filter = "none";
    }
    // Where canvas filters don't exist (older Safari) the image is still
    // unfiltered here: go via a tiny copy, which blurs when scaled back up.
    if (typeof b.filter !== "string") {
      const tiny = document.createElement("canvas");
      tiny.width = 24; tiny.height = 14;
      const kt = Math.max(24 / bmp.width, 14 / bmp.height);
      tiny.getContext("2d")!.drawImage(bmp, (24 - bmp.width * kt) / 2, (14 - bmp.height * kt) / 2, bmp.width * kt, bmp.height * kt);
      b.imageSmoothingQuality = "high";
      b.drawImage(tiny, 0, 0, bd.width, bd.height);
      tiny.width = 0; tiny.height = 0;
    }
    b.fillStyle = "rgba(0,0,0,0.5)";
    b.fillRect(0, 0, bd.width, bd.height);
    return bd;
  };
  const decode = (i: number): Promise<Decoded | null> => {
    if (i < 0 || i >= o.slides.length || failed.has(i)) return Promise.resolve(null);
    const hit = decoded.get(i);
    if (hit) return Promise.resolve(hit);
    const p = pending.get(i);
    if (p) return p;
    const q = o.slides[i].load().then((bmp) => {
      const d: Decoded = { bmp, backdrop: bmp.height > bmp.width ? makeBackdrop(bmp) : null };
      decoded.set(i, d);
      pending.delete(i);
      return d;
    }).catch(() => {
      pending.delete(i);
      failed.add(i);
      const msg = "Some photos couldn’t be loaded and were left out of view (black).";
      if (notes.indexOf(msg) < 0) notes.push(msg);
      return null;
    });
    pending.set(i, q);
    return q;
  };
  const prefetch = (from: number) => {
    for (let i = from; i < Math.min(o.slides.length, from + LOOKAHEAD); i++) {
      if (pending.size >= POOL) break;
      if (!decoded.has(i) && !pending.has(i)) void decode(i);
    }
  };
  const releaseBefore = (keepFrom: number) => {
    Array.from(decoded.keys()).forEach((i) => {
      if (i >= keepFrom) return;
      const d = decoded.get(i)!;
      try { d.bmp.close(); } catch { /* closed */ }
      if (d.backdrop) { d.backdrop.width = 0; d.backdrop.height = 0; }
      decoded.delete(i);
    });
  };

  // ── Drawing ──
  const sc = H / 1080;
  const drawPhoto = (d: Decoded | undefined, slideIdx: number, p: number) => {
    if (!d) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); return; }
    const { bmp, backdrop } = d;
    // Four gentle moves, in turn: push in, drift right, pull out, drift left.
    const move = slideIdx % 4;
    const e = smooth(p) * 0.5 + p * 0.5;
    const Z = 0.06;
    if (backdrop) {
      ctx.drawImage(backdrop, -W * 0.03, -H * 0.03, W * 1.06, H * 1.06);
      const zoom = move === 2 ? 1 + Z * 0.6 * (1 - e) : 1 + Z * 0.6 * e;
      const s = Math.min((W * 0.96) / bmp.width, (H * 0.96) / bmp.height) * zoom;
      const dw = bmp.width * s, dh = bmp.height * s;
      const dx = move === 1 ? (e - 0.5) * 24 * sc : move === 3 ? (0.5 - e) * 24 * sc : 0;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 40 * sc;
      ctx.drawImage(bmp, (W - dw) / 2 + dx, (H - dh) / 2, dw, dh);
      ctx.restore();
      return;
    }
    const base = Math.max(W / bmp.width, H / bmp.height);
    let zoom: number, fx = 0;
    if (move === 0) zoom = 1 + Z * e;
    else if (move === 2) zoom = 1 + Z * (1 - e);
    else { zoom = 1 + Z * 0.8; fx = move === 1 ? e - 0.5 : 0.5 - e; }
    const s = base * zoom;
    const dw = bmp.width * s, dh = bmp.height * s;
    const mx = (dw - W) / 2, my = (dh - H) / 2;
    ctx.drawImage(bmp, -mx + fx * 2 * mx * 0.9, -my, dw, dh);
  };

  const drawTitle = (title: { name: string; line: string }, local: number, item: ShowroomItem) => {
    // In just after the photo arrives; out before it starts to leave.
    const inAt = item.fadeIn * 0.6 + 0.2;
    const outEnd = o.holdSec - 0.1;
    const a = Math.min(smooth((local - inAt) / 0.8), 1 - smooth((local - (outEnd - 0.8)) / 0.8));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha *= a;
    const g = ctx.createLinearGradient(0, H * 0.5, 0, H);
    g.addColorStop(0, rgba(ED.ground, 0));
    g.addColorStop(1, rgba(ED.ground, 0.8));
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.5, W, H * 0.5);
    const rise = (1 - a) * 12 * sc;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 14 * sc;
    const name = title.name.toUpperCase();
    const track = ED.headTrack * sc;
    let size = (name.length > 26 ? 76 : name.length > 16 ? 94 : 108) * sc;
    const maxW = W - 2 * 380 * sc; // clear of a bottom-corner logo
    ctx.font = `600 ${size}px ${o.fonts.serif}`;
    let lines = wrapTracked(ctx, name, maxW, track);
    while (lines.length > 2 && size > 56 * sc) { size -= 6 * sc; ctx.font = `600 ${size}px ${o.fonts.serif}`; lines = wrapTracked(ctx, name, maxW, track); }
    const specY = H - 96 * sc + rise;
    const lastNameY = title.line ? specY - 70 * sc : specY;
    ctx.fillStyle = ED.text;
    lines.forEach((ln, i) => fillTrackedCentered(ctx, ln, W / 2, lastNameY - (lines.length - 1 - i) * size * 0.98, track));
    const topY = lastNameY - (lines.length - 1) * size * 0.98 - size * 0.78;
    ctx.shadowBlur = 0;
    ctx.fillStyle = ED.accent;
    ctx.fillRect(W / 2 - 32 * sc, topY - 26 * sc, 64 * sc, 2 * sc);
    if (title.line) {
      ctx.shadowBlur = 10 * sc;
      ctx.fillStyle = ED.soft;
      ctx.font = `500 ${34 * sc}px ${o.fonts.sans}`;
      fillTrackedCentered(ctx, title.line, W / 2, specY, 3 * sc);
    }
    ctx.restore();
  };

  const drawCornerLogo = (alpha: number) => {
    if (!o.logo || alpha <= 0) return;
    const lh0 = H * 0.06;
    const k = Math.min(lh0 / o.logo.height, (W * 0.16) / o.logo.width);
    const lw = o.logo.width * k, lh = o.logo.height * k;
    const m = 44 * sc;
    const x = o.corner === "bl" || o.corner === "tl" ? m : W - m - lw;
    const y = o.corner === "tl" || o.corner === "tr" ? m : H - m - lh;
    ctx.save();
    ctx.globalAlpha = alpha * 0.9;
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 12 * sc;
    ctx.shadowOffsetY = 2 * sc;
    ctx.drawImage(o.logo, x, y, lw, lh);
    ctx.restore();
  };

  // The card is the same every time — draw it once and reuse it (identical open and close).
  const cardCanvas = document.createElement("canvas");
  cardCanvas.width = W; cardCanvas.height = H;
  drawShowroomCard(cardCanvas.getContext("2d")!, W, H, { logo: o.logo, brandName: o.brandName, tagline: o.tagline, fonts: o.fonts });

  // ── The frame loop ──
  let first = 0; // items before this have finished
  try {
    await decode(0);
    prefetch(1);
    o.onProgress?.({ phase: "rendering", pct: 0 });
    for (let f = 0; f < totalFrames; f++) {
      if (o.cancelled?.()) throw new Error("Cancelled.");
      const t = f / FPS;
      while (first < items.length && items[first].start + items[first].dur <= t) first++;
      const active: ShowroomItem[] = [];
      for (let i = first; i < items.length && items[i].start <= t; i++) if (items[i].start + items[i].dur > t) active.push(items[i]);
      await addMusicUpTo(t + 0.5);

      // The photos on screen must be decoded; start the next few; close the played ones.
      const onScreen = active.filter((x) => x.kind === "photo").map((x) => x.slide);
      for (let n = 0; n < onScreen.length; n++) if (!decoded.has(onScreen[n])) await decode(onScreen[n]);
      if (onScreen.length) {
        releaseBefore(Math.min(...onScreen));
        prefetch(Math.max(...onScreen) + 1);
      }

      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      // Earlier items lie underneath; a crossfading item fades in over them,
      // a dipping one fades out to black. cardCover = how much of the frame
      // the (logo) card covers — the corner logo gives way to it.
      let cardCover = 0;
      active.forEach((it) => {
        const local = t - it.start;
        const aIn = it.fadeIn > 0 ? smooth(local / it.fadeIn) : 1;
        const aOut = it.fadeOut > 0 ? 1 - smooth((local - (it.dur - it.fadeOut)) / it.fadeOut) : 1;
        const a = Math.max(0, Math.min(aIn, aOut));
        if (a <= 0) return;
        ctx.globalAlpha = a;
        if (it.kind === "card") {
          ctx.drawImage(cardCanvas, 0, 0);
        } else {
          drawPhoto(decoded.get(it.slide), it.slide, Math.min(1, Math.max(0, local / it.dur)));
          const title = o.slides[it.slide].title;
          if (title) drawTitle(title, local, it);
        }
        cardCover = it.kind === "card" ? a + cardCover * (1 - a) : cardCover * (1 - a);
        ctx.globalAlpha = 1;
      });
      drawCornerLogo(1 - cardCover);

      await source.add(t, 1 / FPS);
      if (f % 15 === 0) o.onProgress?.({ phase: "rendering", pct: Math.min(99, Math.round((f / totalFrames) * 100)) });
    }
    await addMusicUpTo(total + 1);
    o.onProgress?.({ phase: "finishing", pct: 100 });
    await output.finalize();
  } catch (err) {
    try { await output.cancel(); } catch { /* already gone */ }
    throw err;
  } finally {
    releaseBefore(Number.MAX_SAFE_INTEGER);
    cardCanvas.width = 0; cardCanvas.height = 0;
  }

  let file: Blob;
  if (opfs) {
    file = await opfs.getFile();
  } else {
    const buf = (target as InstanceType<typeof mb.BufferTarget>).buffer;
    if (!buf) throw new Error("The video came back empty.");
    file = new Blob([buf], { type: "video/mp4" });
  }
  return { file, seconds: total, notes };
}
