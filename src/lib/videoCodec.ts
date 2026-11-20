/**
 * Which video codec is inside an MP4 / MOV — read from the file's own boxes
 * (Nov 20, 2026).
 *
 * Why: a broker on a new Windows laptop got sound with a black picture. The
 * file was H.265 (HEVC) inside an .mp4, and Chrome / Edge on a fresh Windows
 * install often can't decode HEVC. ProRes doesn't play in any browser. So the
 * upload path warns about those two, and an admin job checks the stored ones.
 *
 * Pure: no Node and no DOM APIs, works on a Uint8Array, safe in the browser and
 * on the server. Only ever reads small slices of a file — the first chunk, and
 * the `moov` box when it sits after the media data.
 *
 * ISO-BMFF in one paragraph: a file is a list of boxes, each `size(4) type(4)`
 * then the payload; size 1 means a 64-bit size follows the type; size 0 means
 * "to the end of the file / parent". The codec is the fourcc of the first
 * sample entry in moov > trak > mdia > minf > stbl > stsd, for the track whose
 * mdia > hdlr handler type is 'vide'. QuickTime .mov uses the same layout.
 *
 * tsconfig has no target (ES5): no spreading / for..of over Set or Map here.
 */

export type VideoCodecInfo = { codec: string; fourcc: string; width?: number; height?: number };

/** First read: this many bytes from the start of the file. */
export const CODEC_HEAD_BYTES = 1024 * 1024;
/** A moov box bigger than this isn't read (treated as unknown). */
export const CODEC_MAX_MOOV_BYTES = 8 * 1024 * 1024;

/** What may be stored in videos.video_codec (also a CHECK in the migration). */
export const VIDEO_CODEC_PATTERN = /^[a-z0-9:]{2,24}$/;

type Box = { type: string; start: number; payload: number; end: number };

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

function u16(b: Uint8Array, o: number): number {
  return (b[o] << 8) + b[o + 1];
}

function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

/**
 * The box header at `o`, or null when it doesn't fit in `limit`. `end` is the
 * box's declared end (may be past the bytes we hold); size 0 = to `parentEnd`.
 */
function readBox(b: Uint8Array, o: number, limit: number, parentEnd: number): Box | null {
  if (o + 8 > limit) return null;
  const size32 = u32(b, o);
  const type = fourcc(b, o + 4);
  let payload = o + 8;
  let size: number;
  if (size32 === 1) {
    if (o + 16 > limit) return null;
    // 64-bit size. Above 2^53 can't be a real file; the high word times 2^32
    // stays exact for anything that can.
    size = u32(b, o + 8) * 4294967296 + u32(b, o + 12);
    payload = o + 16;
  } else if (size32 === 0) {
    size = parentEnd - o;
  } else {
    size = size32;
  }
  if (size < payload - o) return null; // corrupt: smaller than its own header
  return { type, start: o, payload, end: o + size };
}

/** Child boxes of [from, to), clamped to the bytes we actually hold. */
function children(b: Uint8Array, from: number, to: number): Box[] {
  const limit = Math.min(to, b.length);
  const out: Box[] = [];
  let o = from;
  let guard = 0;
  while (o < limit && guard++ < 10000) {
    const box = readBox(b, o, limit, to);
    if (!box) break;
    out.push(box);
    if (box.end <= o) break;
    o = box.end;
  }
  return out;
}

function child(b: Uint8Array, parent: Box, type: string): Box | null {
  const list = children(b, parent.payload, parent.end);
  for (let i = 0; i < list.length; i++) if (list[i].type === type) return list[i];
  return null;
}

/** Map a sample-entry fourcc to the codec name we store. */
export function classifyFourcc(cc: string): string {
  switch (cc) {
    case "avc1":
    case "avc3":
      return "h264";
    case "hvc1":
    case "hev1":
    case "dvh1":
    case "dvhe":
      return "h265";
    case "av01":
      return "av1";
    case "vp09":
      return "vp9";
    case "apch":
    case "apcn":
    case "apcs":
    case "apco":
    case "ap4h":
    case "ap4x":
      return "prores";
    default: {
      const clean = cc.toLowerCase().replace(/[^a-z0-9]/g, "");
      return `other:${clean || "unknown"}`;
    }
  }
}

/** The video track's first sample entry inside one trak box, or null. */
function videoEntryInTrak(b: Uint8Array, trak: Box): VideoCodecInfo | null {
  const mdia = child(b, trak, "mdia");
  if (!mdia) return null;
  const hdlr = child(b, mdia, "hdlr");
  // hdlr: version/flags(4) pre_defined(4) handler_type(4)
  if (!hdlr || hdlr.payload + 12 > Math.min(hdlr.end, b.length)) return null;
  if (fourcc(b, hdlr.payload + 8) !== "vide") return null;
  const minf = child(b, mdia, "minf");
  const stbl = minf ? child(b, minf, "stbl") : null;
  const stsd = stbl ? child(b, stbl, "stsd") : null;
  if (!stsd) return null;
  // stsd: version/flags(4) entry_count(4), then sample entries (boxes).
  const entries = children(b, stsd.payload + 8, stsd.end);
  if (entries.length === 0) return null;
  const e = entries[0];
  let cc = e.type;

  // Encrypted entries ('encv') name the real format in sinf > frma.
  if (cc === "encv") {
    // Visual sample entry is 78 bytes of fields after the header; boxes follow.
    const sub = children(b, e.payload + 78, e.end);
    for (let i = 0; i < sub.length; i++) {
      if (sub[i].type !== "sinf") continue;
      const frma = child(b, sub[i], "frma");
      if (frma && frma.payload + 4 <= b.length) cc = fourcc(b, frma.payload);
    }
  }

  const info: VideoCodecInfo = { codec: classifyFourcc(cc), fourcc: cc };
  // Visual sample entry: reserved(6) data_ref_index(2) pre_defined/reserved(16) width(2) height(2)
  const wAt = e.payload + 24;
  if (wAt + 4 <= Math.min(e.end, b.length)) {
    const w = u16(b, wAt);
    const h = u16(b, wAt + 2);
    if (w > 0 && h > 0) {
      info.width = w;
      info.height = h;
    }
  }
  return info;
}

/**
 * The video codec of the first video track in `bytes`, which must start at a
 * top-level box boundary (the start of the file, or the start of the moov box).
 * null = no moov, or no video track, in the bytes given.
 */
export function parseVideoCodec(bytes: Uint8Array): VideoCodecInfo | null {
  try {
    const top = children(bytes, 0, Number.MAX_SAFE_INTEGER);
    for (let i = 0; i < top.length; i++) {
      if (top[i].type !== "moov") continue;
      const traks = children(bytes, top[i].payload, top[i].end);
      for (let j = 0; j < traks.length; j++) {
        if (traks[j].type !== "trak") continue;
        const found = videoEntryInTrak(bytes, traks[j]);
        if (found) return found;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Where the moov box is, from a top-level walk of the first chunk.
 *   "in-chunk"          the whole moov is inside `bytes` — parse them directly;
 *   { offset, size }    moov starts at `offset` and is `size` bytes — read that range;
 *   { offset, size: 0 } the walk left the chunk (usually past mdat): SOME box
 *                       starts at `offset` — read its header to see what it is;
 *   null                no moov (a box runs to the end of the file, or garbage).
 */
export function locateMoov(bytes: Uint8Array, fileSize: number): { offset: number; size: number } | "in-chunk" | null {
  let o = 0;
  let guard = 0;
  while (guard++ < 10000) {
    if (o >= fileSize) return null;
    const box = readBox(bytes, o, bytes.length, fileSize);
    if (!box) {
      // Header not in the chunk. Inside the file → the caller reads it.
      return o + 8 <= fileSize && o >= bytes.length - 16 ? { offset: o, size: 0 } : null;
    }
    if (!/^[\x20-\x7e]{4}$/.test(box.type)) return null; // not a box: garbage
    if (box.type === "moov") {
      return box.end <= bytes.length ? "in-chunk" : { offset: box.start, size: box.end - box.start };
    }
    if (box.end <= o || box.end > fileSize) return null;
    o = box.end;
  }
  return null;
}

/** Read bytes [start, end) of the file. */
export type RangeReader = (start: number, end: number) => Promise<Uint8Array>;

/**
 * The whole probe, for any storage: the first 1 MB, then (when moov sits after
 * the media data) a hop over box headers to moov and one read of it, capped at
 * 8 MB. Returns null when the codec can't be determined. Reads only.
 */
export async function probeVideoCodec(
  read: RangeReader,
  fileSize: number,
  opts: { headBytes?: number; maxMoovBytes?: number } = {}
): Promise<VideoCodecInfo | null> {
  if (!(fileSize > 0)) return null;
  const headBytes = opts.headBytes ?? CODEC_HEAD_BYTES;
  const maxMoov = opts.maxMoovBytes ?? CODEC_MAX_MOOV_BYTES;
  const head = await read(0, Math.min(fileSize, headBytes));
  let loc = locateMoov(head, fileSize);
  if (loc === "in-chunk") return parseVideoCodec(head);

  // Hop box to box (mdat, free, …) until moov — a handful at most.
  for (let hop = 0; loc && hop < 8; hop++) {
    if (loc.size === 0) {
      const at: number = loc.offset;
      const hdr = await read(at, Math.min(fileSize, at + 16));
      const box = readBox(hdr, 0, hdr.length, fileSize - at);
      if (!box || !/^[\x20-\x7e]{4}$/.test(box.type) || box.end <= 0) return null;
      if (box.type === "moov") loc = { offset: at, size: box.end };
      else {
        const next = at + box.end;
        loc = next + 8 <= fileSize ? { offset: next, size: 0 } : null;
      }
      continue;
    }
    if (loc.size > maxMoov || loc.offset + loc.size > fileSize) return null;
    const moov = await read(loc.offset, loc.offset + loc.size);
    return parseVideoCodec(moov);
  }
  return null;
}

/** H.265 and ProRes: the two that don't play everywhere in a browser. */
export function isRiskyCodec(codec: string | null | undefined): boolean {
  return codec === "h265" || codec === "prores";
}

/** Short human name, e.g. for the admin list. */
export function codecLabel(codec: string | null | undefined): string {
  if (!codec) return "Not checked";
  switch (codec) {
    case "h264":
      return "H.264";
    case "h265":
      return "H.265 (HEVC)";
    case "av1":
      return "AV1";
    case "vp9":
      return "VP9";
    case "prores":
      return "ProRes";
    case "unknown":
      return "Unknown";
    default:
      return codec.indexOf("other:") === 0 ? codec.slice(6).toUpperCase() : codec;
  }
}

/** The calm notice shown at upload time, or null when there's nothing to say. */
export function codecWarning(codec: string | null | undefined): string | null {
  if (codec === "h265") {
    return "This video is H.265 (HEVC). It can play as sound with a black picture on some Windows laptops. For a video every buyer can watch, export it as H.264 and replace this one.";
  }
  if (codec === "prores") {
    return "This video is ProRes. It will not play in a web browser. Export it as H.264 and replace this one.";
  }
  return null;
}
