/**
 * Offline checks for src/lib/videoCodec.ts (no network, no database).
 *
 *   npx tsx scripts/video_codec_check.ts [video.mp4 …]
 *
 * Builds small synthetic MP4s in memory and asserts what the parser says.
 * If ffmpeg is installed it also makes two tiny real files in /tmp (libx264,
 * and libx265 when this ffmpeg has it) and parses those. Any extra paths given
 * on the command line are probed too and printed (no assertions).
 */
import { execFileSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import {
  isRiskyCodec,
  locateMoov,
  parseVideoCodec,
  probeVideoCodec,
  type VideoCodecInfo,
} from "../src/lib/videoCodec";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// ── box builders ────────────────────────────────────────────────────────────
function cat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  parts.forEach((p) => (n += p.length));
  const out = new Uint8Array(n);
  let o = 0;
  parts.forEach((p) => {
    out.set(p, o);
    o += p.length;
  });
  return out;
}
function be32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
function be16(n: number): Uint8Array {
  return new Uint8Array([(n >>> 8) & 255, n & 255]);
}
function ascii(s: string): Uint8Array {
  return new Uint8Array(s.split("").map((c) => c.charCodeAt(0)));
}
function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = cat(...payload);
  return cat(be32(8 + body.length), ascii(type), body);
}
function zeros(n: number): Uint8Array {
  return new Uint8Array(n);
}
function hdlr(handler: string): Uint8Array {
  return box("hdlr", zeros(4), zeros(4), ascii(handler), zeros(12), new Uint8Array([0]));
}
function visualEntry(cc: string, w: number, h: number): Uint8Array {
  // reserved(6) dref(2) pre_defined/reserved(16) width height, then the rest of the 78 bytes
  return box(cc, zeros(6), be16(1), zeros(16), be16(w), be16(h), zeros(78 - 28));
}
function audioEntry(): Uint8Array {
  return box("mp4a", zeros(6), be16(1), zeros(20));
}
function trak(handler: string, entry: Uint8Array): Uint8Array {
  const stsd = box("stsd", zeros(4), be32(1), entry);
  return box("trak", box("tkhd", zeros(84)), box("mdia", box("mdhd", zeros(24)), hdlr(handler), box("minf", box("stbl", stsd))));
}
const ftyp = box("ftyp", ascii("isom"), be32(512), ascii("isomiso2avc1mp41"));
function mdat(n: number): Uint8Array {
  return box("mdat", zeros(n));
}

async function probeBytes(b: Uint8Array, head = 1024 * 1024): Promise<VideoCodecInfo | null> {
  return probeVideoCodec(async (s, e) => b.slice(s, e), b.length, { headBytes: head });
}

async function main() {
  // 1. ftyp + moov first, avc1 1920×1080
  const f1 = cat(ftyp, box("moov", box("mvhd", zeros(100)), trak("soun", audioEntry()), trak("vide", visualEntry("avc1", 1920, 1080))), mdat(5000));
  const r1 = parseVideoCodec(f1);
  check("moov-first avc1 → h264 1920×1080", r1?.codec === "h264" && r1.width === 1920 && r1.height === 1080, JSON.stringify(r1));
  check("moov-first locateMoov → in-chunk", locateMoov(f1, f1.length) === "in-chunk");
  check("isRiskyCodec(h264) false", !isRiskyCodec("h264"));

  // 2. ftyp + mdat + moov with hvc1 3840×2160; first chunk only covers ftyp+part of mdat
  const moov2 = box("moov", box("mvhd", zeros(100)), trak("vide", visualEntry("hvc1", 3840, 2160)), trak("soun", audioEntry()));
  const f2 = cat(ftyp, mdat(200_000), moov2);
  const head2 = f2.slice(0, 4096);
  const loc2 = locateMoov(head2, f2.length);
  const mdatEnd = ftyp.length + 8 + 200_000;
  check("mdat-first locateMoov → next box after mdat", typeof loc2 === "object" && loc2 !== null && loc2.offset === mdatEnd && loc2.size === 0, JSON.stringify(loc2));
  check("mdat-first parse(head) → null", parseVideoCodec(head2) === null);
  const r2 = await probeBytes(f2, 4096);
  check("mdat-first probe → h265 3840×2160", r2?.codec === "h265" && r2.fourcc === "hvc1" && r2.width === 3840 && r2.height === 2160, JSON.stringify(r2));
  check("isRiskyCodec(h265) true", isRiskyCodec("h265"));
  // Same file, chunk big enough to hold the moov header but not all of it
  const head2b = f2.slice(0, mdatEnd + 12);
  const loc2b = locateMoov(head2b, f2.length);
  check("moov header in chunk, body not → {offset,size}", typeof loc2b === "object" && loc2b !== null && loc2b.offset === mdatEnd && loc2b.size === moov2.length, JSON.stringify(loc2b));

  // 3. 64-bit largesize mdat (size==1) then moov with hev1
  const payload = 300_000;
  const big = cat(be32(1), ascii("mdat"), be32(0), be32(16 + payload), zeros(payload));
  const moov3 = box("moov", trak("vide", visualEntry("hev1", 1280, 720)));
  const f3 = cat(ftyp, big, moov3);
  const loc3 = locateMoov(f3.slice(0, 2048), f3.length);
  check("largesize mdat locateMoov → after mdat", typeof loc3 === "object" && loc3 !== null && loc3.offset === ftyp.length + 16 + payload, JSON.stringify(loc3));
  const r3 = await probeBytes(f3, 2048);
  check("largesize mdat probe → h265 (hev1) 1280×720", r3?.codec === "h265" && r3.fourcc === "hev1" && r3.width === 1280, JSON.stringify(r3));

  // 4. audio only
  const f4 = cat(ftyp, box("moov", trak("soun", audioEntry())), mdat(100));
  check("audio-only → null", parseVideoCodec(f4) === null);
  check("audio-only probe → null", (await probeBytes(f4)) === null);

  // 5. truncated garbage
  const g = new Uint8Array(3000);
  for (let i = 0; i < g.length; i++) g[i] = (i * 7919 + 13) & 255;
  check("garbage parse → null", parseVideoCodec(g) === null);
  check("garbage locateMoov → null", locateMoov(g, g.length) === null);
  check("garbage probe → null", (await probeBytes(g)) === null);
  check("empty probe → null", (await probeBytes(new Uint8Array(0))) === null);
  const trunc = f1.slice(0, 40); // ftyp + a few bytes of moov header
  check("truncated file parse → null", parseVideoCodec(trunc) === null);

  // 6. other codecs + size==0 moov to end
  const f6 = cat(ftyp, cat(be32(0), ascii("moov"), trak("vide", visualEntry("apch", 1920, 1080)).slice(0)));
  const r6 = parseVideoCodec(f6);
  check("size-0 moov to end, apch → prores", r6?.codec === "prores", JSON.stringify(r6));
  check("isRiskyCodec(prores) true", isRiskyCodec("prores"));
  const r7 = parseVideoCodec(cat(ftyp, box("moov", trak("vide", visualEntry("av01", 640, 360)))));
  check("av01 → av1", r7?.codec === "av1");
  const r8 = parseVideoCodec(cat(ftyp, box("moov", trak("vide", visualEntry("mp4v", 640, 360)))));
  check("mp4v → other:mp4v", r8?.codec === "other:mp4v");
  const r9 = parseVideoCodec(cat(ftyp, mdat(10), box("free", zeros(4)), box("moov", trak("vide", visualEntry("dvh1", 640, 360)))));
  check("dvh1 after mdat+free (in chunk) → h265", r9?.codec === "h265");
  const f10 = cat(ftyp, mdat(50_000), box("free", zeros(20)), box("moov", trak("vide", visualEntry("avc3", 800, 600))));
  const r10 = await probeBytes(f10, 1024);
  check("probe hops mdat → free → moov", r10?.codec === "h264" && r10.fourcc === "avc3", JSON.stringify(r10));
  // moov larger than the cap → null
  const f11 = cat(ftyp, mdat(100), box("moov", trak("vide", visualEntry("hvc1", 10, 10)), box("free", zeros(9000))));
  const r11 = await probeVideoCodec(async (s, e) => f11.slice(s, e), f11.length, { headBytes: 64, maxMoovBytes: 4000 });
  check("moov over the cap → null (unknown)", r11 === null);

  // ── real files from ffmpeg ────────────────────────────────────────────────
  let haveFfmpeg = false;
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    haveFfmpeg = true;
  } catch {
    console.log("SKIP  ffmpeg not installed — real-file checks skipped");
  }
  if (haveFfmpeg) {
    const encoders = execFileSync("ffmpeg", ["-hide_banner", "-encoders"]).toString();
    const real: { enc: string; tag?: string; file: string; expect: string; faststart: boolean }[] = [
      { enc: "libx264", file: "/tmp/ypcodec_h264.mp4", expect: "h264", faststart: false },
      { enc: "libx264", file: "/tmp/ypcodec_h264_fast.mp4", expect: "h264", faststart: true },
      { enc: "libx265", tag: "hvc1", file: "/tmp/ypcodec_h265.mp4", expect: "h265", faststart: false },
      { enc: "libx265", file: "/tmp/ypcodec_h265_hev1.mov", expect: "h265", faststart: false },
    ];
    for (let i = 0; i < real.length; i++) {
      const r = real[i];
      if (encoders.indexOf(r.enc) < 0) {
        console.log(`SKIP  ${r.enc} not available in this ffmpeg`);
        continue;
      }
      const args = ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "1", "-c:v", r.enc, "-pix_fmt", "yuv420p", "-c:a", "aac"];
      if (r.tag) args.push("-tag:v", r.tag);
      if (r.faststart) args.push("-movflags", "+faststart");
      args.push(r.file);
      execFileSync("ffmpeg", args, { stdio: "ignore" });
      const bytes = new Uint8Array(readFileSync(r.file));
      const loc = locateMoov(bytes.slice(0, 64), bytes.length);
      const got = await probeBytes(bytes, 64); // tiny first chunk: forces the moov hop when moov is at the end
      check(
        `ffmpeg ${r.enc}${r.tag ? ` (${r.tag})` : ""}${r.faststart ? " +faststart" : ""} → ${r.expect} 320×240`,
        got?.codec === r.expect && got.width === 320 && got.height === 240,
        `${JSON.stringify(got)} · moov ${typeof loc === "string" ? loc : JSON.stringify(loc)}`
      );
    }
  }

  // Extra files from the command line: print what they are.
  const extra = process.argv.slice(2);
  for (let i = 0; i < extra.length; i++) {
    const p = extra[i];
    if (!existsSync(p)) {
      console.log(`MISSING  ${p}`);
      continue;
    }
    const size = statSync(p).size;
    const bytes = new Uint8Array(readFileSync(p));
    console.log(`FILE  ${p} (${size} bytes) →`, JSON.stringify(await probeBytes(bytes)));
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main();
