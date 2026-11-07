// Invoice PDF — letter size, drawn with pdf-lib (same approach as the dock
// card, src/lib/dockCardPdf.ts). Server only. Standard Helvetica, black text,
// grey hairlines, one thin rule in the brand accent. Nothing shouty.
//
// Layout: logo top-left · INVOICE + number / dates (Invoice date, Sent, Due,
// Terms) on the right · accent rule · From / Bill to / Boat · lines table
// (paginates) · totals with the "How to pay" box beside them · note · Notes +
// Terms & Conditions block (invoiceFooter) · page footer. A test invoice says
// TEST INVOICE / TEST where the number goes.
//
// When the invoice can be paid online (same rule as the /inv Pay button,
// onlinePayState === 'ok', using bundle.settings.processor) the How to pay box
// gets a clickable "Pay online: <invoice link>" line in the brand accent. The
// box only grows downward, so the totals never move.

import { PDFArray, PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { PORTAL_ORIGIN, publicInvoiceUrl, type InvoiceBundle } from "./invoices";
import { onlinePayState, payViaLabel } from "./processor";
import { dateET, fmtDate, fmtMoney, fmtPct, invoiceFooter, invoiceLabel, isOverdue, splitPaymentLines } from "./types";

const W = 612;
const H = 792;
const M = 54; // 0.75 in margins
const BLACK = rgb(0.07, 0.08, 0.1);
const GREY = rgb(0.42, 0.45, 0.5);
const LIGHT = rgb(0.86, 0.87, 0.89);
const FAINT = rgb(0.965, 0.968, 0.972);

export const CARD_FEE_NOTE = "If paying by cash, check, Zelle or Venmo, please disregard the card fee.";

/** Helvetica (WinAnsi) can't draw every character — swap the common ones, drop the rest. */
function safe(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[′’‘]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/−/g, "-")
    .replace(/ /g, " ")
    .replace(/[\t\r]/g, " ")
    .replace(/[^\n\x20-\x7e¡-ÿ–—•…€™]/g, "");
}

function hexToRgb(hex: string | null | undefined): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  safe(text).split(/\n| \| /).forEach((para) => {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); return; }
    let line = "";
    words.forEach((w) => {
      const t = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(t, size) <= width) line = t;
      else {
        if (line) out.push(line);
        // A single word longer than the column: hard-cut it.
        let word = w;
        while (font.widthOfTextAtSize(word, size) > width && word.length > 1) {
          let k = word.length - 1;
          while (k > 1 && font.widthOfTextAtSize(word.slice(0, k), size) > width) k--;
          out.push(word.slice(0, k));
          word = word.slice(k);
        }
        line = word;
      }
    });
    if (line) out.push(line);
  });
  return out;
}

async function fetchLogo(url: string | null): Promise<{ bytes: Uint8Array; png: boolean } | null> {
  if (!url) return null;
  const abs = url.startsWith("/") ? PORTAL_ORIGIN + url : url;
  if (!/^https:\/\//.test(abs)) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(abs, { signal: ctrl.signal, cache: "force-cache" });
    clearTimeout(t);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    return png || jpg ? { bytes, png } : null;
  } catch {
    return null;
  }
}

/** A clickable URI link over [x1,y1]–[x2,y2]; appended to any Annots the page already has. */
function addLink(doc: PDFDocument, page: PDFPage, rect: [number, number, number, number], url: string) {
  const ctx = doc.context;
  const ref = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: rect,
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    })
  );
  const existing = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (existing) existing.push(ref);
  else page.node.set(PDFName.of("Annots"), ctx.obj([ref]));
}

function qty(n: number): string {
  return (Math.round(n * 1000) / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
}
function rate(n: number): string {
  const v = Math.round(n * 10000) / 10000;
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export async function buildInvoicePdf(b: InvoiceBundle): Promise<Uint8Array> {
  const { invoice: inv, lines, client, brand, settings } = b;
  const doc = await PDFDocument.create();
  doc.setTitle(`${inv.is_test ? "TEST invoice" : `Invoice ${inv.number ?? "(draft)"}`} — ${brand.display_name}`);
  doc.setAuthor(brand.legal_name);
  doc.setCreator("YachtPics Portal");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const accent = hexToRgb(brand.accent_color) ?? GREY;

  let logo: PDFImage | null = null;
  const lb = await fetchLogo(brand.logo_url);
  if (lb) {
    try { logo = lb.png ? await doc.embedPng(lb.bytes) : await doc.embedJpg(lb.bytes); } catch { logo = null; }
  }

  const pages: PDFPage[] = [];
  let page = doc.addPage([W, H]);
  pages.push(page);

  const text = (p: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont = reg, color: RGB = BLACK) =>
    p.drawText(safe(s), { x, y, size, font, color });
  const right = (p: PDFPage, s: string, xr: number, y: number, size: number, font: PDFFont = reg, color: RGB = BLACK) =>
    p.drawText(safe(s), { x: xr - font.widthOfTextAtSize(safe(s), size), y, size, font, color });
  const hline = (p: PDFPage, y: number, x1 = M, x2 = W - M, color: RGB = LIGHT, t = 0.6) =>
    p.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: t, color });
  const spaced = (s: string) => s.split("").join(" ");

  // ── Header ────────────────────────────────────────────────────────────
  let y = H - M;
  if (logo) {
    const maxW = 173, maxH = 43; // 2.4 in × 0.6 in
    const sc = Math.min(maxW / logo.width, maxH / logo.height);
    const lw = logo.width * sc, lh = logo.height * sc;
    page.drawImage(logo, { x: M, y: y - lh, width: lw, height: lh });
  } else {
    text(page, brand.display_name, M, y - 22, 20, bold);
  }

  const xr = W - M;
  right(page, spaced(inv.is_test ? "TEST INVOICE" : "INVOICE"), xr, y - 9, 9, bold, GREY);
  right(page, invoiceLabel(inv), xr, y - 28, 17, bold);
  let hy = y - 46;
  const meta: [string, string][] = [
    ["Invoice date", fmtDate(inv.issue_date)],
    ["Sent", fmtDate(dateET(inv.sent_at))],
    // A draft's due date is set when it's sent (unless typed by hand).
    ["Due", inv.status === "draft" && !inv.due_date_manual ? "" : fmtDate(inv.due_date)],
  ];
  meta.push(["Terms", !inv.terms_days ? "Due on receipt" : `Net ${inv.terms_days}`]);
  meta.forEach(([k, v]) => {
    if (!v) return;
    right(page, v, xr, hy, 9);
    right(page, k, xr - 92, hy, 9, reg, GREY);
    hy -= 13;
  });
  const statusWord = inv.status === "paid" ? "PAID" : inv.status === "void" ? "VOID" : isOverdue(inv) ? "OVERDUE" : null;
  if (statusWord) { right(page, spaced(statusWord), xr, hy - 2, 9, bold, inv.status === "paid" ? accent : GREY); hy -= 15; }

  y = Math.min(y - 60, hy - 8);
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.9, color: accent });
  y -= 22;

  // ── From / Bill to / Boat ─────────────────────────────────────────────
  const colW = (W - 2 * M - 24) / 3;
  const block = (x: number, label: string, rows: (string | null | undefined)[]) => {
    text(page, spaced(label.toUpperCase()), x, y, 7, bold, GREY);
    let by = y - 14;
    rows.filter(Boolean).forEach((r, i) => {
      wrap(r as string, i === 0 ? bold : reg, 9, colW).forEach((ln) => {
        text(page, ln, x, by, 9, i === 0 ? bold : reg, i === 0 ? BLACK : rgb(0.25, 0.27, 0.3));
        by -= 12;
      });
    });
    return by;
  };
  const fromY = block(M, "From", [brand.legal_name, settings.address, settings.phone, settings.replyTo, brand.website]);
  const billRows: (string | null)[] = client
    ? [client.display_name, client.company_name && client.company_name !== client.display_name ? client.company_name : null, client.email, client.phone || client.mobile]
    : ["—"];
  const billY = block(M + colW + 12, "Bill to", billRows);
  let boatY = y;
  if (inv.boat_name) {
    boatY = block(M + 2 * (colW + 12), "Boat", [
      inv.boat_name,
      inv.boat_length_ft ? `${Math.round(inv.boat_length_ft * 10) / 10} ft` : null,
    ]);
  }
  y = Math.min(fromY, billY, boatY) - 18;

  // ── Lines table ───────────────────────────────────────────────────────
  // Columns (right edges for numbers): Description | Qty | Unit | Rate | Discount | Amount
  const cAmt = xr, cDisc = xr - 72, cRate = xr - 140, cUnit = xr - 210, cQty = xr - 246;
  const descW = cQty - 30 - M;
  const header = (p: PDFPage, yy: number) => {
    text(p, spaced("DESCRIPTION"), M, yy, 7, bold, GREY);
    right(p, spaced("QTY"), cQty, yy, 7, bold, GREY);
    text(p, spaced("UNIT"), cUnit - 26, yy, 7, bold, GREY);
    right(p, spaced("RATE"), cRate, yy, 7, bold, GREY);
    right(p, spaced("DISCOUNT"), cDisc, yy, 7, bold, GREY);
    right(p, spaced("AMOUNT"), cAmt, yy, 7, bold, GREY);
    hline(p, yy - 7, M, W - M, LIGHT, 0.6);
    return yy - 20;
  };
  y = header(page, y);
  const bottom = M + 40;
  const newPage = (tableHeader = true) => {
    page = doc.addPage([W, H]);
    pages.push(page);
    let ny = H - M;
    text(page, `${brand.display_name} · ${inv.is_test ? "TEST invoice" : `Invoice ${inv.number ?? "(draft)"}`}`, M, ny - 9, 9, reg, GREY);
    ny -= 30;
    return tableHeader ? header(page, ny) : ny;
  };

  lines.forEach((l) => {
    const nameLines = wrap(l.name, bold, 9, descW);
    const descLines = l.description ? wrap(l.description, reg, 8, descW) : [];
    const noteLines = l.kind === "card_fee" ? wrap(CARD_FEE_NOTE, reg, 8, descW) : [];
    const h = nameLines.length * 12 + (descLines.length + noteLines.length) * 10.5 + 10;
    if (y - h < bottom) y = newPage();
    const top = y;
    nameLines.forEach((ln, i) => text(page, ln, M, top - i * 12, 9, bold));
    let dy = top - nameLines.length * 12;
    descLines.forEach((ln) => { text(page, ln, M, dy + 1, 8, reg, GREY); dy -= 10.5; });
    noteLines.forEach((ln) => { text(page, ln, M, dy + 1, 8, reg, GREY); dy -= 10.5; });

    const isFee = l.kind === "card_fee";
    right(page, isFee ? "" : qty(l.quantity), cQty, top, 9);
    text(page, isFee ? fmtPct(inv.card_fee_rate) : l.unit === "ft" ? "per ft" : "each", cUnit - 26, top, 9, reg, GREY);
    right(page, isFee ? "" : rate(l.kind === "discount" ? -Math.abs(l.unit_price) : l.unit_price), cRate, top, 9);
    const d = Number(l.line_discount || 0);
    right(page, d ? (l.discount_type === "percent" ? `${Number(l.discount_value)}%` : "-" + fmtMoney(d)) : "", cDisc, top, 9, reg, GREY);
    right(page, fmtMoney(Number(l.line_total ?? 0)), cAmt, top, 9);
    y = dy - 8;
    hline(page, y + 4, M, W - M, FAINT, 0.6);
    y -= 6;
  });

  // ── Totals (right) and How to pay (left, beside them) ─────────────────
  const rows: [string, string, boolean?][] = [["Subtotal", fmtMoney(inv.subtotal)]];
  if (inv.discount_total) rows.push(["Discounts", "-" + fmtMoney(inv.discount_total)]);
  if (inv.tax_total) rows.push([`Sales tax ${fmtPct(inv.tax_rate)}`, fmtMoney(inv.tax_total)]);
  if (inv.card_fee_total) rows.push([`Card fee ${fmtPct(inv.card_fee_rate)}`, fmtMoney(inv.card_fee_total)]);
  rows.push(["Total", fmtMoney(inv.total), true]);
  if (inv.amount_paid) rows.push(["Paid", "-" + fmtMoney(inv.amount_paid)]);
  if (inv.card_fee_waived) rows.push(["Card fee not charged", "-" + fmtMoney(inv.card_fee_waived)]);
  rows.push(["Balance due", fmtMoney(inv.status === "void" ? 0 : inv.balance_due), true]);

  const tl = xr - 200;
  const payW = tl - M - 28;
  const hasInstr = !!settings.paymentInstructions && inv.status !== "void" && inv.status !== "paid";
  const pl = hasInstr ? wrap(splitPaymentLines(settings.paymentInstructions).join("\n"), reg, 9, payW - 28) : [];

  // "Pay online" link — only when /inv would show the Pay button (sent /
  // partial, balance >= $0.50, not a test, processor on).
  const onlineUrl = inv.public_token && onlinePayState(inv, settings.processor ?? null) === "ok" ? publicInvoiceUrl(inv.public_token) : null;
  const innerW = payW - 28;
  const payLabel = "Pay online: ";
  const shownUrl = onlineUrl ? onlineUrl.replace(/^https?:\/\//, "") : "";
  // One line if it fits (9 pt down to 7.5 pt), else label and link on two lines.
  let linkSize = 9;
  let linkTwoLines = false;
  if (onlineUrl) {
    const w1 = (sz: number) => bold.widthOfTextAtSize(payLabel, sz) + reg.widthOfTextAtSize(safe(shownUrl), sz);
    while (linkSize > 7.5 && w1(linkSize) > innerW) linkSize -= 0.5;
    if (w1(linkSize) > innerW) {
      linkTwoLines = true;
      linkSize = 9;
      while (linkSize > 6 && reg.widthOfTextAtSize(safe(shownUrl), linkSize) > innerW) linkSize -= 0.5;
    }
  }
  const linkH = onlineUrl ? (pl.length ? 8 : 0) + (linkTwoLines ? 24 : 12) + 12 : 0;

  const showPay = hasInstr || !!onlineUrl;
  const payH = showPay ? 30 + pl.length * 12 + linkH : 0;
  const totH = rows.length * 16 + 10;
  if (y - Math.max(totH, payH) - 8 < bottom) y = newPage(false);
  y -= 8;
  const top = y;
  rows.forEach(([k, v, strong]) => {
    if (strong) hline(page, y + 11, tl, xr, LIGHT, 0.6);
    text(page, k, tl, y, strong ? 10 : 9, strong ? bold : reg, strong ? BLACK : GREY);
    right(page, v, xr, y, strong ? 10 : 9, strong ? bold : reg);
    y -= strong ? 18 : 15;
  });
  if (showPay) {
    const bx = M, by = top + 12;
    page.drawRectangle({ x: bx, y: by - payH, width: payW, height: payH, borderColor: LIGHT, borderWidth: 0.7, color: FAINT });
    text(page, spaced("HOW TO PAY"), bx + 14, by - 16, 7, bold, GREY);
    let py = by - 31;
    pl.forEach((ln) => { text(page, ln, bx + 14, py, 9); py -= 12; });
    if (onlineUrl) {
      if (pl.length) py -= 8;
      const lx = bx + 14;
      const topY = py + linkSize; // top of the first text line
      let x2: number;
      if (!linkTwoLines) {
        text(page, payLabel, lx, py, linkSize, bold, accent);
        const ux = lx + bold.widthOfTextAtSize(payLabel, linkSize);
        text(page, shownUrl, ux, py, linkSize, reg, accent);
        x2 = ux + reg.widthOfTextAtSize(safe(shownUrl), linkSize);
        py -= 12;
      } else {
        text(page, "Pay online:", lx, py, 9, bold, accent);
        py -= 12;
        text(page, shownUrl, lx, py, linkSize, reg, accent);
        x2 = lx + Math.max(bold.widthOfTextAtSize("Pay online:", 9), reg.widthOfTextAtSize(safe(shownUrl), linkSize));
        py -= 12;
      }
      addLink(doc, page, [lx - 2, py + 12 - 3, x2 + 2, topY + 2], onlineUrl);
      text(page, payViaLabel(settings.processor), lx, py, 8, reg, GREY);
      py -= 12;
    }
    y = Math.min(y, by - payH - 6);
  }
  y -= 14;

  // ── Note ──────────────────────────────────────────────────────────────
  if (inv.note) {
    const nl = wrap(inv.note, reg, 9, W - 2 * M);
    if (y - nl.length * 12 - 20 < bottom) y = newPage(false);
    text(page, spaced("NOTE"), M, y, 7, bold, GREY);
    y -= 14;
    nl.forEach((ln) => { text(page, ln, M, y, 9); y -= 12; });
    y -= 10;
  }

  // ── Notes + Terms & Conditions (one block, after everything else) ─────
  const ft = invoiceFooter(brand, settings.paymentInstructions);
  const fw = W - 2 * M;
  const notesLines: string[] = [];
  ft.notes.forEach((n) => wrap(n, reg, 8.5, fw).forEach((ln) => notesLines.push(ln)));
  const termLines: string[] = [];
  ft.terms.forEach((t) => wrap(t, reg, 8.5, fw).forEach((ln) => termLines.push(ln)));
  const sectionH = (n: number) => 14 + n * 11 + 10;
  const drawSection = (label: string, rowsIn: string[]) => {
    if (!rowsIn.length) return;
    if (y - sectionH(rowsIn.length) < bottom) y = newPage(false);
    text(page, spaced(label.toUpperCase()), M, y, 7, bold, GREY);
    y -= 13;
    rowsIn.forEach((ln) => {
      if (y < bottom) { y = newPage(false); }
      text(page, ln, M, y, 8.5, reg, rgb(0.25, 0.27, 0.3));
      y -= 11;
    });
    y -= 10;
  };
  if (notesLines.length || termLines.length) {
    if (y - 30 < bottom) y = newPage(false);
    hline(page, y + 4, M, W - M, LIGHT, 0.5);
    y -= 12;
  }
  drawSection("Notes", notesLines);
  drawSection("Terms & Conditions", termLines);

  // ── Footer on every page ──────────────────────────────────────────────
  const small = [brand.legal_name, brand.website].filter(Boolean).join(" · ");
  pages.forEach((p, i) => {
    hline(p, M + 20, M, W - M, LIGHT, 0.5);
    if (inv.is_test) p.drawText("TEST INVOICE — not a real invoice", { x: M, y: M + 6, size: 8.5, font: bold, color: GREY });
    right(p, pages.length > 1 ? `${small}   ·   ${i + 1} / ${pages.length}` : small, xr, M + 6, 8, reg, GREY);
  });

  return doc.save();
}
