"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Renders a downloadable QR code for a listing's public slideshow.
 * The URL passed in should already carry the source tag (e.g. ?src=qr) so
 * scans are attributed correctly.
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
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">QR code</p>
          <p className="text-xs text-gray-500 mt-0.5 max-w-xs">
            Print this on dock signage, a boat-show card, or a flyer. A scan opens this boat&rsquo;s slideshow — and every scan is tracked.
          </p>
        </div>
        {dataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="Listing QR code" className="w-20 h-20 shrink-0 cursor-pointer rounded" onClick={() => setOpen(true)} />
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={download}
          disabled={!dataUrl}
          className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          ⬇ Download PNG
        </button>
        <button
          onClick={() => setOpen(true)}
          disabled={!dataUrl}
          className="border border-gray-200 hover:border-[#d4a843] text-gray-600 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          Enlarge
        </button>
      </div>

      {open && dataUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl p-6 text-center" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dataUrl} alt="Listing QR code" className="w-64 h-64 mx-auto" />
            <p className="text-sm font-medium text-gray-700 mt-3">{vesselName ?? "Listing"}</p>
            <button onClick={download} className="mt-4 bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-5 py-2 rounded-lg">⬇ Download PNG</button>
          </div>
        </div>
      )}
    </div>
  );
}
