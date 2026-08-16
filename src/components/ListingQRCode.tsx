"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui";

/**
 * Renders a downloadable QR code for a listing's public slideshow.
 * The URL passed in should already carry the source tag (e.g. ?src=qr) so
 * scans are attributed correctly.
 *
 * The code itself must stay high-contrast to scan reliably: near-black ink
 * modules on a pure white field. Only the surrounding chrome is themed.
 */
export default function ListingQRCode({ url, vesselName }: { url: string; vesselName?: string | null }) {
  const [dataUrl, setDataUrl] = useState<string>("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, { width: 512, margin: 2, color: { dark: "#050b14", light: "#ffffff" } })
      .then((d) => { if (active) setDataUrl(d); })
      .catch(() => { if (active) setDataUrl(""); });
    return () => { active = false; };
  }, [url]);

  function download() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    const safe = (vesselName ?? "listing").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    a.download = `${safe || "listing"}-qr.png`;
    a.click();
  }

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label-caps mb-1">QR code</p>
          <p className="text-xs text-ink-500 mt-0.5 max-w-xs leading-relaxed">
            Print this on dock signage, a boat-show card, or a flyer. A scan opens this boat&rsquo;s slideshow — and every scan is tracked.
          </p>
        </div>
        {dataUrl && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Enlarge QR code"
            className="shrink-0 rounded-[3px] border border-hairline bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dataUrl} alt="Listing QR code" className="w-20 h-20 cursor-pointer" />
          </button>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          onClick={download}
          disabled={!dataUrl}
          className="bg-ink-950 text-white hover:bg-ink-800"
        >
          ⬇ Download PNG
        </Button>
        <Button variant="secondary" onClick={() => setOpen(true)} disabled={!dataUrl}>
          Enlarge
        </Button>
      </div>

      {open && dataUrl && (
        <div className="fixed inset-0 z-50 bg-ink-950/80 flex items-center justify-center p-6" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-surface shadow-elev-3 p-6 text-center" onClick={(e) => e.stopPropagation()}>
            {/* The QR field stays pure white so the code scans from a screen too */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dataUrl} alt="Listing QR code" className="w-64 h-64 mx-auto" />
            <p className="label-caps mt-3">{vesselName ?? "Listing"}</p>
            <Button onClick={download} className="mt-4 bg-ink-950 text-white hover:bg-ink-800">
              ⬇ Download PNG
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
