/**
 * In Review reels (admin, Oct 31) — the render engine. Browser only.
 *
 *   opening card → one photo per boat → the YachtPics end card
 *
 * Built from the reel's own parts rather than a copy of them:
 *   • the frames are ReelMaker's (1080×1920 / 1920×1080, 30 fps, H.264 at
 *     QUALITY_HIGH through mediabunny's CanvasSource);
 *   • the motion is ReelMaker's Editorial still — exteriors pull out from
 *     1 + zoom to 1, anything else pushes in, on its smoothstep drift —
 *     with the zoom scaled to the shorter hold so the speed stays gentle;
 *   • joins are reelTransitions' drawTransition (cut or dissolve);
 *   • the closing card is ReelMaker's own end card (src/lib/reelEndCard.ts),
 *     YachtPics-branded, with nobody to credit;
 *   • music is reelMusic, composed in the browser.
 *
 * Nothing is drawn over the boats: no names, captions, brokers or logos.
 *
 * Memory stays flat however many boats (a year can be 300+): unlike
 * ReelMaker, which decodes every photo before it starts, only the photos on
 * screen plus a window ahead of the playhead are decoded (a pool of a few
 * fetches at once), each bitmap is closed as soon as it has played, frames go
 * straight to the encoder, and where the browser has the Origin Private File
 * System the MP4 streams to disk instead of memory — the Showroom Loop's
 * approach (src/lib/showroomRender.ts).
 *
 * Music: up to 150 s the reel gets one reelMusic track, cut to every boat and
 * resolving on the end card, exactly as a listing reel's. Longer (a year at a
 * slow pace) it is scored in ~75 s stretches, each composed just before it
 * plays and crossfaded into the next over 1 s, as the Showroom Loop does —
 * reelMusic is built for reel-length tracks.
 */
import { composeReelMusic, MUSIC_SAMPLE_RATE, musicCanCompose, type MusicMood } from "@/lib/reelMusic";
import { REEL_STYLES, applyBrand, isExterior, type ReelStyle } from "@/lib/reelStyles";
import { drawTransition } from "@/lib/reelTransitions";
import { drawReelEndCard } from "@/lib/reelEndCard";
import { ease, fillTrackedCentered, loadBitmap, wrapTracked } from "@/lib/canvasText";
import { YACHTPICS_CARD, YACHTPICS_COLORS, YACHTPICS_PHONES, type YpPhone } from "@/lib/yachtpicsBrand";
import {
  REVIEW_FRAMES, reviewTimeline,
  type ReviewFormat, type ReviewFraming, type ReviewItem, type ReviewTransition,
} from "@/lib/reviewReel";

export const REVIEW_FPS = 30;
const OPFS_NAME = "review-render.mp4";
/** Photos decoded ahead of the playhead, and fetched at once. */
const LOOKAHEAD = 10;
const POOL = 4;
/** One music track up to this; longer reels are scored in stretches. */
const ONE_TRACK_MAX_SEC = 150;
const MUSIC_STRETCH_SEC = 75;
const MUSIC_XFADE = 1;
/** For the in-memory size check only (QUALITY_HIGH lands well under this at 1080p). */
const EST_BITRATE = 12_000_000;
/** ReelMaker's Editorial zoom at its ceiling hold (1.9 s). */
const EDITORIAL_HOLD = 1.9;

export type ReviewSlide = {
  /** Fetches and decodes the photo (≤ ~2200 px on the long side). */
  load: () => Promise<ImageBitmap>;
  /** Exterior (pull out) or not (push in) — ReelMaker's rule. */
  category: string | null;
};

export type ReviewRenderOptions = {
  canvas: HTMLCanvasElement;
  format: ReviewFormat;
  slides: ReviewSlide[];
  secPerBoat: number;
  transition: ReviewTransition;
  framing: ReviewFraming;
  line1: string;
  line2: string;
  /** serif = the raw Cormorant family (the end card adds its own fallbacks). */
  fonts: { serif: string; sans: string };
  music: { mood: MusicMood; seed: number } | null;
  /** Whose number goes on the end card. */
  phone?: YpPhone;
  onProgress?: (p: { phase: "preparing" | "rendering" | "finishing"; pct: number }) => void;
  cancelled?: () => boolean;
};

export type ReviewResult = { file: Blob; seconds: number; notes: string[]; withMusic: boolean };

type Decoded = { bmp: ImageBitmap; backdrop: HTMLCanvasElement | null };

/** The look: Editorial in YachtPics' colours — what a YachtPics-branded reel uses. */
export function reviewStyle(): ReelStyle {
  return applyBrand(REEL_STYLES.editorial, YACHTPICS_COLORS);
}

/** The opening card (also drawn small on the page as a preview). */
export function drawReviewOpenCard(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  o: { line1: string; line2: string; fonts: { serif: string; sans: string }; st?: ReelStyle },
) {
  const st = o.st ?? reviewStyle();
  const sc = Math.min(W, H) / 1080;
  const g = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.08, W / 2, H * 0.45, Math.max(W, H) * 0.7);
  g.addColorStop(0, "#14233a");
  g.addColorStop(1, st.ground);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const serif = `${o.fonts.serif}, Georgia, serif`;
  const head = o.line1.trim().toUpperCase();
  const track = st.headTrack * sc;
  const maxW = W - 160 * sc;
  let size = 104 * sc;
  ctx.font = `600 ${size}px ${serif}`;
  let lines = head ? wrapTracked(ctx, head, maxW, track) : [];
  while ((lines.length > 3 || lines.some((l) => ctx.measureText(l).width > maxW)) && size > 52 * sc) {
    size -= 4 * sc;
    ctx.font = `600 ${size}px ${serif}`;
    lines = wrapTracked(ctx, head, maxW, track);
  }
  const lineH = size * 1.02;
  const sub = o.line2.trim().toUpperCase();
  const subSize = 30 * sc;
  const ruleGap = 44 * sc;
  const blockH = lines.length * lineH + (sub ? ruleGap * 2 + subSize : 0);
  // A vertical reel keeps its type clear of Instagram's furniture (top 14%,
  // bottom 35%): centred a little above the middle.
  const cy = H > W ? H * 0.42 : H * 0.5;
  let y = cy - blockH / 2;
  ctx.fillStyle = st.text;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 14 * sc;
  lines.forEach((ln) => {
    y += lineH;
    fillTrackedCentered(ctx, ln, W / 2, y - size * 0.2, track);
  });
  ctx.shadowBlur = 0;
  if (sub) {
    ctx.fillStyle = st.accent;
    ctx.fillRect(W / 2 - 40 * sc, y + ruleGap - 1.1 * sc, 80 * sc, Math.max(1.5, 2.2 * sc));
    ctx.fillStyle = st.soft;
    ctx.font = `600 ${subSize}px ${o.fonts.sans}`;
    fillTrackedCentered(ctx, sub, W / 2, y + ruleGap * 2 + subSize * 0.8, 7 * sc);
  }
}

export async function renderReviewReel(o: ReviewRenderOptions): Promise<ReviewResult> {
  const { w: W, h: H } = REVIEW_FRAMES[o.format];
  const FPS = REVIEW_FPS;
  if (!o.slides.length) throw new Error("Pick at least one boat.");
  const notes: string[] = [];
  const { items, total, endStart } = reviewTimeline(o.slides.length, o.secPerBoat, o.transition);
  const totalFrames = Math.round(total * FPS);
  const canvas = o.canvas;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.imageSmoothingQuality = "high";
  const st = reviewStyle();
  const sc = Math.min(W, H) / 1080;
  o.onProgress?.({ phase: "preparing", pct: 0 });

  try {
    await Promise.all([
      document.fonts.load(`600 100px ${o.fonts.serif}`),
      document.fonts.load(`400 100px ${o.fonts.serif}`),
      document.fonts.load(`italic 400 44px ${o.fonts.serif}`),
      ...[400, 500, 600].map((w) => document.fonts.load(`${w} 40px ${o.fonts.sans}`)),
    ]);
    await document.fonts.ready;
  } catch { /* older browser: fall through */ }

  const mb = await import("mediabunny");
  const codec = await mb.getFirstEncodableVideoCodec(["avc"], { width: W, height: H });
  if (!codec) throw new Error("This browser can’t encode H.264 video. Use Chrome or Edge on a computer.");

  let music = o.music;
  if (music) {
    let ok = false;
    try { ok = musicCanCompose() && (await mb.canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: MUSIC_SAMPLE_RATE, quality: mb.QUALITY_HIGH })); } catch { ok = false; }
    if (!ok) { music = null; notes.push("This browser can’t add music to a video, so the reel is silent. Chrome or Edge on a computer can."); }
  }

  // The two cards are still: draw each once.
  const openCanvas = document.createElement("canvas");
  openCanvas.width = W; openCanvas.height = H;
  drawReviewOpenCard(openCanvas.getContext("2d")!, W, H, { line1: o.line1, line2: o.line2, fonts: o.fonts, st });
  let logo: ImageBitmap | null = null;
  try { if (YACHTPICS_CARD.logoUrl) logo = await loadBitmap(YACHTPICS_CARD.logoUrl); } catch { logo = null; }
  const endCanvas = document.createElement("canvas");
  endCanvas.width = W; endCanvas.height = H;
  drawReelEndCard(endCanvas.getContext("2d")!, {
    W, H, sc, alpha: 1, st,
    serifFamily: o.fonts.serif, sans: o.fonts.sans,
    name: "", builder: "", logo, yp: true, broker: null,
    card: { ...YACHTPICS_CARD, phone: YACHTPICS_PHONES[o.phone ?? "charlie"].phone },
  });
  if (logo) { try { logo.close(); } catch { /* closed */ } logo = null; }

  // Where the file goes: the browser's private storage when it can, else memory.
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
  if (!opfs && (total * EST_BITRATE) / 8 > 1.6e9) {
    throw new Error("This browser can’t hold a video this long in memory. Use Chrome or Edge, or fewer boats / fewer seconds each.");
  }

  const target = fsw
    ? new mb.StreamTarget(fsw as unknown as WritableStream<import("mediabunny").StreamTargetChunk>, { chunked: true })
    : new mb.BufferTarget();
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: fsw ? "reserve" : "in-memory" }), target });
  const source = new mb.CanvasSource(canvas, { codec: "avc", quality: mb.QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: FPS, maximumPacketCount: Math.ceil(totalFrames * 1.34) + 60 });
  const audio = music ? new mb.AudioBufferSource({ codec: "aac", quality: mb.QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio, { maximumPacketCount: Math.ceil((total * MUSIC_SAMPLE_RATE) / 1024 * 1.34) + 200 });
  await output.start();

  // ── Music ──
  // Stretch k spans [starts[k], starts[k+1]) plus MUSIC_XFADE of tail, mixed
  // into the head of stretch k+1. One stretch = one ordinary reel track.
  const photoStarts = items.filter((x) => x.kind === "photo").map((x) => x.start);
  const starts: number[] = [0];
  if (total > ONE_TRACK_MAX_SEC) {
    photoStarts.forEach((s) => {
      if (s - starts[starts.length - 1] >= MUSIC_STRETCH_SEC && endStart - s >= 30) starts.push(s);
    });
  }
  const cutsAll = photoStarts.concat([endStart]);
  let nextChunk = 0;
  let carry: Float32Array<ArrayBuffer>[] | null = null;
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
      const cuts = cutsAll.filter((c) => c > b0 + 0.3 && c < b0 + durSec - 0.3).map((c) => c - b0);
      const resolveAt = lastChunk ? endStart - b0 : durSec - tail / SR - 2.5;
      let chans: Float32Array<ArrayBuffer>[];
      try {
        const buf = await composeReelMusic({ durationSec: durSec, cutTimesSec: cuts, mood: music.mood, seed: (music.seed + k * 7919) >>> 0, endCardStartSec: resolveAt });
        chans = [0, 1].map((c) => { const d = new Float32Array(len); d.set(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)).subarray(0, len)); return d; });
      } catch {
        chans = [new Float32Array(len), new Float32Array(len)];
        const msg = "Part of the music couldn’t be made; that stretch is silent.";
        if (notes.indexOf(msg) < 0) notes.push(msg);
      }
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

  // ── Photos: a window ahead of the playhead, closed once played ──
  const decoded = new Map<number, Decoded>();
  const pending = new Map<number, Promise<Decoded | null>>();
  const failed: Record<number, true> = {};
  const makeBackdrop = (bmp: ImageBitmap): HTMLCanvasElement => {
    // ReelMaker's "whole photo" plate: the photo covering the frame, blurred
    // and dimmed, built once at quarter size.
    const c = document.createElement("canvas");
    c.width = Math.round(W / 4); c.height = Math.round(H / 4);
    const b = c.getContext("2d")!;
    const k = Math.max(c.width / bmp.width, c.height / bmp.height) * 1.1;
    const dw = bmp.width * k, dh = bmp.height * k;
    b.filter = "blur(14px) brightness(0.55) saturate(0.85)";
    b.drawImage(bmp, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    b.filter = "none";
    return c;
  };
  const decode = (i: number): Promise<Decoded | null> => {
    if (i < 0 || i >= o.slides.length || failed[i]) return Promise.resolve(null);
    const hit = decoded.get(i);
    if (hit) return Promise.resolve(hit);
    const p = pending.get(i);
    if (p) return p;
    const q = o.slides[i].load().then((bmp) => {
      const d: Decoded = { bmp, backdrop: o.framing === "whole" ? makeBackdrop(bmp) : null };
      decoded.set(i, d);
      pending.delete(i);
      return d;
    }).catch(() => {
      pending.delete(i);
      failed[i] = true;
      const msg = "Some photos couldn’t be loaded and show as a blank frame — check them and render again.";
      if (notes.indexOf(msg) < 0) notes.push(msg);
      return null;
    });
    pending.set(i, q);
    return q;
  };
  const prefetch = (from: number) => {
    for (let i = from; i < Math.min(o.slides.length, from + LOOKAHEAD); i++) {
      if (pending.size >= POOL) break;
      if (!decoded.has(i) && !pending.has(i) && !failed[i]) void decode(i);
    }
  };
  const release = (d: Decoded) => {
    try { d.bmp.close(); } catch { /* closed */ }
    if (d.backdrop) { d.backdrop.width = 0; d.backdrop.height = 0; }
  };
  const releaseBefore = (keepFrom: number) => {
    Array.from(decoded.keys()).forEach((i) => {
      if (i >= keepFrom) return;
      release(decoded.get(i)!);
      decoded.delete(i);
    });
  };

  // ── Drawing ──
  // ReelMaker's Editorial still: exteriors pull out, the rest push in, on a
  // smoothstep drift that runs through the outgoing join. Its 8% zoom is
  // spread over a 1.9 s hold; at a fraction of that it is scaled down so the
  // speed of the move stays the same — gentle, not a lurch.
  const Z = REEL_STYLES.editorial.zoom * Math.min(1, o.secPerBoat / EDITORIAL_HOLD);
  const drawPhoto = (it: ReviewItem, t: number, alpha: number) => {
    const d = decoded.get(it.index);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (!d) {
      ctx.fillStyle = st.ground;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      return;
    }
    const { bmp, backdrop } = d;
    const drift = ease((t - it.start) / it.dur);
    const out = isExterior(o.slides[it.index].category);
    const k = out ? 1 + Z * (1 - drift) : 1 + Z * drift;
    if (o.framing === "fill" || !backdrop) {
      const s = Math.max(W / bmp.width, H / bmp.height) * k;
      const dw = bmp.width * s, dh = bmp.height * s;
      ctx.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      ctx.drawImage(backdrop, 0, 0, W, H);
      const margin = 0.055 * Math.min(W, H);
      const base = Math.min((W - margin * 2) / bmp.width, (H - margin * 2) / bmp.height);
      const s = base * (1 + (k - 1) * 0.45);
      const dw = bmp.width * s, dh = bmp.height * s;
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 40 * sc;
      ctx.shadowOffsetY = 12 * sc;
      ctx.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
    ctx.restore();
  };
  const drawItem = (it: ReviewItem, t: number, alpha: number) => {
    if (it.kind === "photo") { drawPhoto(it, t, alpha); return; }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(it.kind === "open" ? openCanvas : endCanvas, 0, 0);
    ctx.restore();
  };

  // ── The frame loop ──
  let first = 0;
  try {
    await decode(0);
    prefetch(1);
    o.onProgress?.({ phase: "rendering", pct: 0 });
    for (let f = 0; f < totalFrames; f++) {
      if (o.cancelled?.()) throw new Error("Cancelled.");
      const t = f / FPS;
      while (first < items.length && items[first].start + items[first].dur <= t) first++;
      const active: ReviewItem[] = [];
      for (let i = first; i < items.length && items[i].start <= t; i++) if (items[i].start + items[i].dur > t) active.push(items[i]);
      await addMusicUpTo(t + 0.5);

      const onScreen = active.filter((x) => x.kind === "photo").map((x) => x.index);
      for (let n = 0; n < onScreen.length; n++) if (!decoded.has(onScreen[n]) && !failed[onScreen[n]]) await decode(onScreen[n]);
      if (onScreen.length) {
        releaseBefore(Math.min(...onScreen));
        prefetch(Math.max(...onScreen) + 1);
      }

      ctx.globalAlpha = 1;
      ctx.fillStyle = st.ground;
      ctx.fillRect(0, 0, W, H);
      if (active.length === 1) {
        drawItem(active[0], t, 1);
      } else if (active.length >= 2) {
        // The outgoing item and the one arriving over it (never more than two:
        // a join is always shorter than a boat's turn).
        const a = active[active.length - 2], b = active[active.length - 1];
        const p = b.fadeIn > 0 ? (t - b.start) / b.fadeIn : 1;
        if (p >= 1) drawItem(b, t, 1);
        else {
          drawTransition(ctx, W, H, { type: b.fadeIn > 0 ? "dissolve" : "cut", dur: b.fadeIn, dir: "left" }, p, st.ground,
            (al) => drawItem(a, t, al), (al) => drawItem(b, t, al));
        }
      }

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
    // Anything still decoding when the render stopped: close it when it lands.
    pending.forEach((p) => { void p.then((d) => { if (d) release(d); }); });
    openCanvas.width = 0; openCanvas.height = 0;
    endCanvas.width = 0; endCanvas.height = 0;
  }

  let file: Blob;
  if (opfs) {
    file = await opfs.getFile();
  } else {
    const buf = (target as InstanceType<typeof mb.BufferTarget>).buffer;
    if (!buf) throw new Error("The video came back empty.");
    file = new Blob([buf], { type: "video/mp4" });
  }
  return { file, seconds: total, notes, withMusic: !!music };
}
