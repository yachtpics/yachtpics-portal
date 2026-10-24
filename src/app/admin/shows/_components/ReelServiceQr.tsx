"use client";

import { useState } from "react";
import QRCode from "qrcode";

/**
 * Admin → Shows: download a QR for the public Reel Service landing
 * (portal.yachtpics.com/rs), as PNG or SVG, for the boat-show giveaway piece.
 * Plain near-black on white so it scans from engraved or printed stock.
 */
const URL_RS = "https://portal.yachtpics.com/rs";
const COLOR = { dark: "#050b14", light: "#ffffff" };

function save(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function ReelServiceQr() {
  const [err, setErr] = useState("");
  async function png() {
    setErr("");
    try { save(await QRCode.toDataURL(URL_RS, { width: 2048, margin: 2, errorCorrectionLevel: "M", color: COLOR }), "reel-service-qr.png"); }
    catch { setErr("Couldn’t make the PNG."); }
  }
  async function svg() {
    setErr("");
    try {
      const text = await QRCode.toString(URL_RS, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: COLOR });
      const href = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
      save(href, "reel-service-qr.svg");
      setTimeout(() => URL.revokeObjectURL(href), 5000);
    } catch { setErr("Couldn’t make the SVG."); }
  }
  return (
    <div className="mb-6 bg-white border border-hairline rounded-card shadow-elev-1 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-ink-900">Reel Service QR</p>
        <p className="text-xs text-ink-500 mt-0.5">Opens portal.yachtpics.com/rs &mdash; brokers sign in and pick the boat. For the giveaway piece.</p>
        {err && <p className="text-xs text-danger-700 mt-1">{err}</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={png} className="text-xs font-semibold px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400">Reel Service QR (PNG)</button>
        <button type="button" onClick={svg} className="text-xs font-semibold px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400">Reel Service QR (SVG)</button>
      </div>
    </div>
  );
}
