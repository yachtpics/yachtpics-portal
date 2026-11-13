/**
 * Assertions for src/lib/logoContrast.ts — run: npx tsx scripts/logo_contrast_check.ts [real-logo.png]
 * Synthetic RGBA images; optionally a real logo file (decoded with sharp).
 */
import sharp from "sharp";
import { analyseLogoContrast } from "../src/lib/logoContrast";

type Px = [number, number, number, number];
function img(w: number, h: number, paint: (x: number, y: number) => Px): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(paint(x, y), (y * w + x) * 4);
  return d;
}
const T: Px = [0, 0, 0, 0];
const W = 400, H = 200;
// A "mark" block on the right (silver gradient) and "text" bars on the left.
const inMark = (x: number, y: number) => x > 260 && x < 380 && y > 20 && y < 180;
const inText = (x: number, y: number) => x > 20 && x < 240 && ((y > 80 && y < 96) || (y > 110 && y < 126));
const silver = (y: number): Px => { const v = 150 + Math.round((y / H) * 80); return [v, v, v + 4, 255]; };

const cases: { name: string; data: Uint8ClampedArray; w: number; h: number; bg: string; want: boolean }[] = [
  { name: "black text + silver mark", data: img(W, H, (x, y) => inMark(x, y) ? silver(y) : inText(x, y) ? [10, 10, 10, 255] : T), w: W, h: H, bg: "#050b14", want: true },
  { name: "all-white logo", data: img(W, H, (x, y) => inMark(x, y) || inText(x, y) ? [255, 255, 255, 255] : T), w: W, h: H, bg: "#050b14", want: false },
  { name: "silver-only mark on navy", data: img(W, H, (x, y) => inMark(x, y) ? silver(y) : T), w: W, h: H, bg: "#0b1d36", want: false },
  { name: "mid-grey mark on navy", data: img(W, H, (x, y) => inMark(x, y) ? [128, 128, 128, 255] : T), w: W, h: H, bg: "#0b1d36", want: false },
  { name: "colour mark + dark navy text", data: img(W, H, (x, y) => inMark(x, y) ? [200, 40, 40, 255] : inText(x, y) ? [12, 30, 70, 255] : T), w: W, h: H, bg: "#050b14", want: true },
  { name: "opaque white box + black text", data: img(W, H, (x, y) => inText(x, y) ? [0, 0, 0, 255] : [255, 255, 255, 255]), w: W, h: H, bg: "#050b14", want: false },
  { name: "black text + silver on LIGHT bg (Gallery)", data: img(W, H, (x, y) => inMark(x, y) ? silver(y) : inText(x, y) ? [10, 10, 10, 255] : T), w: W, h: H, bg: "#f4f2ed", want: false },
  { name: "white logo + small dark detail (~4%)", data: img(W, H, (x, y) => inMark(x, y) ? (y > 172 ? [20, 20, 20, 255] : [255, 255, 255, 255]) : T), w: W, h: H, bg: "#050b14", want: false },
  { name: "fully transparent", data: img(W, H, () => T), w: W, h: H, bg: "#050b14", want: false },
];

async function main() {
  const real = process.argv[2];
  if (real) {
    const { data, info } = await sharp(real).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Every dark ground a broker logo is drawn on.
    for (const bg of ["#050b14", "#000000", "#0b1118", "#06090f", "#14100a", "#0b1d36", "#0b1019"]) {
      cases.push({ name: `REAL ${info.width}x${info.height} on ${bg}`, data: new Uint8ClampedArray(data), w: info.width, h: info.height, bg, want: true });
    }
  }
  let failed = 0;
  for (const c of cases) {
    const r = analyseLogoContrast(c.data, c.w, c.h, c.bg);
    const ok = r.needsPlate === c.want;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${c.name.padEnd(44)} bg ${c.bg}  plate=${r.needsPlate}  low=${(r.lowShare * 100).toFixed(1)}%  cover=${(r.coverage * 100).toFixed(1)}%  (${r.reason})`);
  }
  if (failed) { console.error(`${failed} failed`); process.exit(1); }
  console.log("all passed");
}
main();
