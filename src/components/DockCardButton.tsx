"use client";

import { useState } from "react";

/**
 * "Dock card" (Nov 1) — the everyday dock card PDF for a boat with a published
 * slideshow (/api/listings/[id]/dock-card). Its QR is the YachtPics
 * always-live link, so it works with or without a plan. Size: 5×7 or Letter.
 * Opens the PDF in a new tab to print or save.
 */
export default function DockCardButton({ listingId, className = "" }: { listingId: string; className?: string }) {
  const [size, setSize] = useState<"5x7" | "letter">("5x7");
  return (
    <div className={`inline-flex items-stretch rounded-lg border border-hairline-strong bg-white overflow-hidden ${className}`}>
      <a
        href={`/api/listings/${listingId}/dock-card?size=${size}`}
        target="_blank"
        rel="noopener noreferrer"
        title="A printable card for the boat: her photo, her specs, your name, and a QR code that opens her slideshow and video"
        className="flex items-center gap-2 text-ink-700 hover:text-ink-900 hover:bg-ink-50 text-sm font-medium px-4 py-2 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
        </svg>
        Dock card
      </a>
      <select
        value={size}
        onChange={(e) => setSize(e.target.value === "letter" ? "letter" : "5x7")}
        aria-label="Dock card size"
        className="border-0 border-l border-hairline-strong bg-white text-sm text-ink-600 pl-2 pr-7 py-2 focus:ring-0"
      >
        <option value="5x7">5×7</option>
        <option value="letter">Letter</option>
      </select>
    </div>
  );
}
