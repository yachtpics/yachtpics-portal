import { LOGO_ANALYSIS_MAX, LOGO_PLATE_COLOR, analyseLogoContrast, isDarkBackground, logoPlateBox, type LogoContrast } from "@/lib/logoContrast";

/**
 * Canvas side of the logo plate (src/lib/logoContrast.ts): analyse an
 * already-loaded logo against a background, and draw the plate behind it.
 * Browser only (needs a canvas). The logo must be CORS-clean — every caller
 * loads it with fetch → blob (loadBitmap) or crossOrigin="anonymous".
 */

type LogoSource = CanvasImageSource & { width: number; height: number };

// Per logo object, per background colour — drawn every frame, analysed once.
const cache = new WeakMap<object, Map<string, LogoContrast>>();

function smallCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  return null;
}

/** The analysis of `logo` on `bgHex` (cached). Fails open to "no plate". */
export function logoContrastOn(logo: LogoSource, bgHex: string): LogoContrast {
  const none: LogoContrast = { needsPlate: false, coverage: 0, lowShare: 0, reason: "empty" };
  const key = bgHex.toLowerCase();
  let byBg = cache.get(logo);
  const hit = byBg?.get(key);
  if (hit) return hit;
  let result = none;
  if (!isDarkBackground(bgHex)) {
    result = { needsPlate: false, coverage: 0, lowShare: 0, reason: "light-background" };
  } else if (logo.width > 0 && logo.height > 0) {
    try {
      // Drawn at 4× the analysis size, then box-filtered down by the pure
      // function: a single drawImage straight to 96 px drops thin lettering.
      const k = Math.min(1, (LOGO_ANALYSIS_MAX * 4) / Math.max(logo.width, logo.height));
      const w = Math.max(1, Math.round(logo.width * k)), h = Math.max(1, Math.round(logo.height * k));
      const c = smallCanvas(w, h);
      const cx = c?.getContext("2d", { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
      if (c && cx) {
        cx.clearRect(0, 0, w, h);
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = "high";
        cx.drawImage(logo, 0, 0, w, h);
        const data = cx.getImageData(0, 0, w, h).data;
        result = analyseLogoContrast(data, w, h, bgHex);
        c.width = 0; c.height = 0; // release the pixels now
      }
    } catch {
      result = none; // tainted canvas or no 2D context — draw as today
    }
  }
  if (!byBg) { byBg = new Map(); cache.set(logo, byBg); }
  byBg.set(key, result);
  return result;
}

export function logoNeedsPlateOn(logo: LogoSource, bgHex: string): boolean {
  return logoContrastOn(logo, bgHex).needsPlate;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/**
 * Fill the plate for a logo that will be drawn at (lx, ly, lw, lh). Uses the
 * context's current globalAlpha, so it fades with the logo.
 */
export function drawLogoPlate(ctx: CanvasRenderingContext2D, lx: number, ly: number, lw: number, lh: number) {
  const box = logoPlateBox(lw, lh);
  ctx.save();
  ctx.fillStyle = LOGO_PLATE_COLOR;
  roundRect(ctx, lx - box.pad, ly - box.pad, box.w, box.h, box.radius);
  ctx.fill();
  ctx.restore();
}
