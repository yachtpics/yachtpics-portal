// Dock card — a print-ready PDF for a boat at a show (FLIBS 2026 first).
// Server only. Drawn with pdf-lib (vector text + a vector QR code from the
// `qrcode` encoder already used by the listing QR card), so it prints sharp at
// any size. Standard PDF fonts only (Times for the vessel name, Helvetica for
// the rest) — no font files to ship.
//
// Layout, top to bottom: the cover photograph full-bleed; a dark band with the
// specifications (accent, tracked caps), the vessel name and her dock / slip;
// an ivory panel with the broker's logo, name, brokerage and contact on the
// left and the QR code on the right (ivory keeps any logo legible and gives
// the code a clean quiet zone); a thin footer with the show and a discreet
// "YachtPics Portal".

import {
  PDFDocument, StandardFonts, rgb, clip, endPath, popGraphicsState, pushGraphicsState,
  rectangle, setCharacterSpacing, type PDFFont, type PDFImage, type PDFPage, type RGB,
} from "pdf-lib";
import QRCode from "qrcode";

export type DockCardSize = "5x7" | "letter";

export type DockCardImage = { bytes: Uint8Array; kind: "jpg" | "png" };

export type DockCardInput = {
  size: DockCardSize;
  photo: DockCardImage | null;
  vesselName: string;
  specLine: string;          // "2019 · 65' · Viking 65 Convertible"
  location: string | null;   // dock / slip
  brokerName: string | null;
  brokerage: string | null;
  phone: string | null;
  email: string | null;
  logo: DockCardImage | null;
  qrUrl: string;
  showName: string;          // "Fort Lauderdale International Boat Show"
  showShort: string;         // "FLIBS 2026"
  showDates: string;         // "October 28 – November 1"
  brandAccent?: string | null; // broker's accent (#rrggbb), optional
  brandGround?: string | null; // broker's background (#rrggbb), used when dark
};

const PAGE: Record<DockCardSize, [number, number]> = {
  "5x7": [360, 504],     // 5 × 7 in at 72 pt/in
  letter: [612, 792],    // 8.5 × 11 in
};

const INK = rgb(5 / 255, 11 / 255, 20 / 255);           // #050b14 — the slideshow's ground
const GOLD = rgb(195 / 255, 158 / 255, 78 / 255);       // #c39e4e — the Portal accent
const IVORY = rgb(247 / 255, 244 / 255, 237 / 255);     // #f7f4ed
const TEXT_DARK = rgb(17 / 255, 24 / 255, 39 / 255);    // #111827
const TEXT_MUTED = rgb(91 / 255, 101 / 255, 115 / 255); // #5b6573
const ON_DARK = rgb(1, 1, 1);
const ON_DARK_SOFT = rgb(201 / 255, 206 / 255, 214 / 255); // #c9ced6
const FOOTER_TEXT = rgb(138 / 255, 147 / 255, 160 / 255);  // #8a93a0
const FOOTER_MARK = rgb(91 / 255, 101 / 255, 115 / 255);   // #5b6573

function hexToRgb(hex: string | null | undefined): { c: RGB; lum: number } | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return { c: rgb(r / 255, g / 255, b / 255), lum };
}

/** Standard PDF fonts speak WinAnsi only: map the few typographic characters
 * listings use and drop anything else that can't be encoded. */
const WIN_ANSI_EXTRA = new Set(Array.from("‘’“”–—•…€™"));
export function pdfSafe(s: string | null | undefined): string {
  if (!s) return "";
  const mapped = s
    .replace(/′/g, "'")
    .replace(/″/g, "\"")
    .replace(/[   ]/g, " ")
    .replace(/[\r\n\t]+/g, " ");
  let out = "";
  for (const ch of Array.from(mapped)) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)) out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

function widthOf(text: string, font: PDFFont, size: number, tracking = 0): number {
  return font.widthOfTextAtSize(text, size) + Math.max(0, text.length - 1) * tracking;
}

/** Largest size ≤ start that fits; at `min` it truncates with an ellipsis. */
function fitText(text: string, font: PDFFont, maxW: number, start: number, min: number, tracking = 0): { text: string; size: number } {
  let size = start;
  while (size > min && widthOf(text, font, size, tracking) > maxW) size -= 0.5;
  if (widthOf(text, font, size, tracking) <= maxW) return { text, size };
  let t = text;
  while (t.length > 1 && widthOf(`${t}…`, font, size, tracking) > maxW) t = t.slice(0, -1);
  return { text: `${t.trimEnd()}…`, size };
}

function drawTracked(page: PDFPage, text: string, opts: { x: number; y: number; size: number; font: PDFFont; color: RGB; tracking: number }) {
  if (!text) return;
  page.pushOperators(setCharacterSpacing(opts.tracking));
  page.drawText(text, { x: opts.x, y: opts.y, size: opts.size, font: opts.font, color: opts.color });
  page.pushOperators(setCharacterSpacing(0));
}

async function embed(doc: PDFDocument, img: DockCardImage | null): Promise<PDFImage | null> {
  if (!img) return null;
  try {
    return img.kind === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
  } catch {
    return null;
  }
}

/** Sniff the bytes: only JPEG and PNG can be embedded. */
export function imageKind(bytes: Uint8Array): "jpg" | "png" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return null;
}

export async function buildDockCardPdf(input: DockCardInput): Promise<Uint8Array> {
  const [W, H] = PAGE[input.size];
  const u = W / 360; // every measurement below is in 5×7 points, scaled

  const doc = await PDFDocument.create();
  doc.setTitle(`${pdfSafe(input.vesselName) || "Dock card"} — ${pdfSafe(input.showShort)}`);
  doc.setAuthor(pdfSafe(input.brokerName ?? input.brokerage ?? "YachtPics Portal"));
  doc.setCreator("YachtPics Portal");
  doc.setProducer("YachtPics Portal");

  const page = doc.addPage([W, H]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [photo, logo] = await Promise.all([embed(doc, input.photo), embed(doc, input.logo)]);

  // The broker's brand first: their background if it's dark enough to carry
  // white type, their accent for the fine details.
  const ground = (() => { const g = hexToRgb(input.brandGround); return g && g.lum < 0.3 ? g.c : INK; })();
  const accent = hexToRgb(input.brandAccent)?.c ?? GOLD;

  const m = 22 * u;
  const footerH = 26 * u;
  const panelH = 112 * u;
  const textH = 118 * u;
  const photoH = H - footerH - panelH - textH;
  const photoY = H - photoH;
  const panelTop = footerH + panelH;

  // Ground
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: ground });

  // Cover photograph, cropped to fill.
  if (photo) {
    const scale = Math.max(W / photo.width, photoH / photo.height);
    const dw = photo.width * scale, dh = photo.height * scale;
    page.pushOperators(pushGraphicsState(), rectangle(0, photoY, W, photoH), clip(), endPath());
    page.drawImage(photo, { x: (W - dw) / 2, y: photoY + (photoH - dh) / 2, width: dw, height: dh });
    page.pushOperators(popGraphicsState());
  }
  page.drawRectangle({ x: 0, y: photoY - 0.8 * u, width: W, height: 0.8 * u, color: accent });

  // Specifications, vessel name, dock.
  const textW = W - 2 * m;
  const spec = fitText(pdfSafe(input.specLine).toUpperCase(), sansBold, textW, 7.5 * u, 6 * u, 1.4 * u);
  drawTracked(page, spec.text, { x: m, y: photoY - 30 * u, size: spec.size, font: sansBold, color: accent, tracking: 1.4 * u });

  const name = fitText(pdfSafe(input.vesselName) || "Untitled vessel", serif, textW, 32 * u, 16 * u);
  page.drawText(name.text, { x: m, y: photoY - 30 * u - 36 * u, size: name.size, font: serif, color: ON_DARK });

  const loc = pdfSafe(input.location);
  if (loc) {
    const line = fitText(loc, sans, textW, 10.5 * u, 8 * u);
    page.drawText(line.text, { x: m, y: photoY - 30 * u - 36 * u - 24 * u, size: line.size, font: sans, color: ON_DARK_SOFT });
  }

  // Ivory panel
  page.drawRectangle({ x: 0, y: footerH, width: W, height: panelH, color: IVORY });

  // QR code — vector modules, black on ivory.
  const qrSize = 76 * u;
  const qrX = W - m - qrSize;
  const qrY = footerH + 22 * u;
  const qr = QRCode.create(input.qrUrl, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = qrSize / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) {
        // A hair of overlap so neighbouring modules print as one solid shape.
        page.drawRectangle({ x: qrX + c * cell, y: qrY + qrSize - (r + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: TEXT_DARK });
      }
    }
  }
  const scanCap = fitText("Scan for the slideshow and video", sans, qrSize + 14 * u, 6.5 * u, 5 * u);
  page.drawText(scanCap.text, {
    x: qrX + qrSize - widthOf(scanCap.text, sans, scanCap.size),
    y: footerH + 10 * u, size: scanCap.size, font: sans, color: TEXT_MUTED,
  });

  // Broker block
  const leftW = qrX - 16 * u - m;
  let y = panelTop - 16 * u; // running top edge
  if (logo) {
    const maxW = Math.min(leftW * 0.8, 140 * u);
    const maxH = 30 * u;
    const s = Math.min(maxW / logo.width, maxH / logo.height);
    const lw = logo.width * s, lh = logo.height * s;
    page.drawImage(logo, { x: m, y: y - lh, width: lw, height: lh });
    y -= lh + 16 * u;
  } else if (input.brokerage) {
    const b = fitText(pdfSafe(input.brokerage), serif, leftW, 15 * u, 10 * u);
    page.drawText(b.text, { x: m, y: y - b.size * 0.8, size: b.size, font: serif, color: TEXT_DARK });
    y -= b.size * 0.8 + 16 * u;
  } else {
    y -= 6 * u;
  }

  const lines: { text: string; font: PDFFont; size: number; color: RGB }[] = [];
  if (input.brokerName) lines.push({ text: pdfSafe(input.brokerName), font: sansBold, size: 11 * u, color: TEXT_DARK });
  if (logo && input.brokerage) lines.push({ text: pdfSafe(input.brokerage), font: sans, size: 8.5 * u, color: TEXT_MUTED });
  const phone = pdfSafe(input.phone), email = pdfSafe(input.email);
  const joined = [phone, email].filter(Boolean).join("   ·   ");
  if (joined && widthOf(joined, sans, 8.5 * u) <= leftW) {
    lines.push({ text: joined, font: sans, size: 8.5 * u, color: TEXT_MUTED });
  } else {
    if (phone) lines.push({ text: phone, font: sans, size: 8.5 * u, color: TEXT_MUTED });
    if (email) lines.push({ text: email, font: sans, size: 8.5 * u, color: TEXT_MUTED });
  }
  const floor = footerH + 8 * u;
  for (const line of lines) {
    const f = fitText(line.text, line.font, leftW, line.size, line.size * 0.75);
    if (y - f.size < floor) break;
    page.drawText(f.text, { x: m, y: y - f.size * 0.8, size: f.size, font: line.font, color: line.color });
    y -= f.size + 4 * u;
  }

  // Footer: the show, small; the Portal mark, smaller.
  const mark = "YachtPics Portal";
  const markSize = 6 * u;
  const markW = widthOf(mark, sans, markSize, 0.6 * u);
  const footY = footerH / 2 - 2.2 * u;
  drawTracked(page, mark, { x: W - m - markW, y: footY, size: markSize, font: sans, color: FOOTER_MARK, tracking: 0.6 * u });
  const showMax = W - 2 * m - markW - 12 * u;
  const longShow = `${pdfSafe(input.showName)}  ·  ${pdfSafe(input.showDates)}`.toUpperCase();
  const shortShow = `${pdfSafe(input.showShort)}  ·  ${pdfSafe(input.showDates)}`.toUpperCase();
  const showText = widthOf(longShow, sans, 6.5 * u, 1 * u) <= showMax ? longShow : shortShow;
  const sf = fitText(showText, sans, showMax, 6.5 * u, 5 * u, 1 * u);
  drawTracked(page, sf.text, { x: m, y: footY, size: sf.size, font: sans, color: FOOTER_TEXT, tracking: 1 * u });

  return doc.save();
}
