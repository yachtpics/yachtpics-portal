/**
 * Logo stack (Nov 7) — the middle band and the geometry.
 *
 * The reel is three horizontal bands: photographs top and bottom (swapped
 * by ReelMaker with Stack's own band swaps, on Stack's beat — the timeline
 * is planLogoStack in @/lib/reelStack), and between them a solid plate with
 * the brokerage logo centred on it — the same logo the end card uses, or
 * YachtPics' when the brokerage has none — which never changes. Optionally
 * the boat's name and length sit under the logo.
 *
 * Pure drawing helpers — no DOM lookups — so ReelMaker and a local frame
 * check can both call them.
 */

import { fillTrackedCentered } from "./canvasText";
import { luminance } from "./reelStyles";

export type LogoStackOptions = {
  /** Height of the logo band. */
  middle: "third" | "quarter" | "fifth";
  /** The logo band's plate: dark navy, white, or the look's (or broker's) accent. */
  background: "navy" | "white" | "accent";
  /** Boat name and length under the logo. */
  showName: boolean;
  /** Whose logo: the brokerage's (end card's), or YachtPics'. */
  logo: "brokerage" | "yachtpics";
};

export const LOGO_STACK_DEFAULTS: LogoStackOptions = { middle: "third", background: "navy", showName: false, logo: "brokerage" };
export const LOGO_STACK_NAVY = "#0b1d36";
const MIDDLE_FRACTION: Record<LogoStackOptions["middle"], number> = { third: 1 / 3, quarter: 1 / 4, fifth: 1 / 5 };

/** YachtPics' marks: white for a dark plate, dark for a light one. */
export const YP_LOGO_WHITE = "/brand/yachtpics-logo-white.png";
export const YP_LOGO_DARK = "/brand/yachtpics-logo-dark.png";

type Rect = { x: number; y: number; w: number; h: number };
type Img = CanvasImageSource & { width: number; height: number };
type MakeCanvas = (w: number, h: number) => HTMLCanvasElement;

/** The three bands on a W×H frame. The photo bands split what the logo band leaves. */
export function logoStackBands(W: number, H: number, middle: LogoStackOptions["middle"]): { top: Rect; mid: Rect; bottom: Rect } {
  const midH = Math.round(H * (MIDDLE_FRACTION[middle] ?? MIDDLE_FRACTION.third));
  const photoH = Math.round((H - midH) / 2);
  return {
    top: { x: 0, y: 0, w: W, h: photoH },
    mid: { x: 0, y: photoH, w: W, h: midH },
    bottom: { x: 0, y: photoH + midH, w: W, h: H - photoH - midH },
  };
}

/** The plate colour for an option; `accent` is the look's accent after the broker's colours. */
export function logoStackPlate(background: LogoStackOptions["background"], accent: string): string {
  if (background === "white") return "#ffffff";
  if (background === "accent") return accent;
  return LOGO_STACK_NAVY;
}

export function plateIsLight(plate: string): boolean {
  return luminance(plate) > 0.4;
}

/**
 * The logo ready for its plate. Most marks are drawn exactly as uploaded.
 * Only a transparent mark that would nearly vanish on the plate — a white
 * wordmark on the white plate, a navy one on navy — is recoloured to a flat
 * silhouette in the plate's ink. A logo on its own opaque background (a JPEG
 * box) is never touched: recolouring it would draw a solid rectangle.
 */
export function prepareLogo(logo: Img, plate: string, makeCanvas: MakeCanvas): Img {
  const size = 48;
  const probe = makeCanvas(size, size);
  const pctx = probe.getContext("2d", { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
  if (!pctx) return logo;
  pctx.drawImage(logo, 0, 0, size, size);
  const data = pctx.getImageData(0, 0, size, size).data;
  let opaque = 0, lumSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    opaque++;
    const hex = "#" + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    lumSum += luminance(hex);
  }
  probe.width = 0; probe.height = 0;
  const total = size * size;
  if (opaque === 0 || opaque / total > 0.95) return logo;
  const lm = lumSum / opaque, lp = luminance(plate);
  const ratio = (Math.max(lm, lp) + 0.05) / (Math.min(lm, lp) + 0.05);
  if (ratio >= 2.2) return logo;
  const c = makeCanvas(logo.width, logo.height);
  const cctx = c.getContext("2d")!;
  cctx.drawImage(logo, 0, 0);
  cctx.globalCompositeOperation = "source-in";
  cctx.fillStyle = plateIsLight(plate) ? "#141a21" : "#ffffff";
  cctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** The logo band: plate, centred logo, and the optional name line under it. */
export function drawLogoStackMiddle(ctx: CanvasRenderingContext2D, rect: Rect, o: {
  W: number; sc: number; alpha: number; plate: string; logo: Img | null; text: string | null; sans: string;
}) {
  const { W, sc, alpha, plate, logo, text, sans } = o;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = plate;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const light = plateIsLight(plate);
  const textSize = Math.round(Math.min(32 * sc, rect.h * 0.085));
  const textGap = text ? Math.round(textSize * 1.1) : 0;
  const textH = text ? textSize + textGap : 0;
  let lw = 0, lh = 0;
  if (logo) {
    const aspect = logo.width / Math.max(1, logo.height);
    // A wide wordmark gets the width it needs; a squarer crest a column.
    lw = aspect > 3 ? W * 0.64 : W * 0.42;
    lh = lw / aspect;
    const maxLh = rect.h * (text ? 0.5 : 0.6);
    if (lh > maxLh) { lh = maxLh; lw = lh * aspect; }
  }
  const blockH = lh + textH;
  let y = rect.y + (rect.h - blockH) / 2;
  const cx = rect.x + rect.w / 2;
  if (logo) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(logo, cx - lw / 2, y, lw, lh);
    y += lh;
  }
  if (text) {
    ctx.fillStyle = light ? "rgba(20,26,33,0.86)" : "rgba(255,255,255,0.9)";
    ctx.font = `600 ${textSize}px ${sans}`;
    ctx.textBaseline = "alphabetic";
    fillTrackedCentered(ctx, text, cx, y + textGap + textSize * 0.8, 6 * sc);
  }
  ctx.restore();
}

/** "NAME  ·  62′" — the optional line under the logo. Null when there's nothing to say. */
export function logoStackLine(name: string | null | undefined, lengthFt: number | null | undefined): string | null {
  const bits = [(name ?? "").trim().toUpperCase() || null, lengthFt ? `${Math.round(Number(lengthFt) * 10) / 10}′` : null].filter(Boolean) as string[];
  return bits.length ? bits.join("   ·   ") : null;
}
