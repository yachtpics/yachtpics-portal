"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadBitmap } from "@/lib/canvasText";
import { LOGO_PLATE_COLOR, logoPlateBox } from "@/lib/logoContrast";
import { logoNeedsPlateOn } from "@/lib/logoPlateCanvas";

/** The dark swatch — ink-950, the spec sheet / report bar colour. */
const DARK_SWATCH = "#050b14";
/** Logo height in the dark swatch preview (px), for sizing the plate. */
const PREVIEW_LOGO_H = 36;

/**
 * Admin broker page → Logo. Lets the owner put a broker's logo on their
 * account (or take it off) before the broker ever opens My Profile. Calls
 * POST / DELETE /api/admin/brokers/[id]/logo, which stores exactly what the
 * broker's own upload stores. The preview sits on a light AND a dark swatch,
 * because a logo with dark lettering vanishes on the dark cards (reel end
 * card, spec sheet, social post).
 */
export default function BrokerLogoCard({ brokerId, initialUrl }: { brokerId: string; initialUrl: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Will dark surfaces put this logo on the light plate? (Same test they use.)
  const [plated, setPlated] = useState(false);

  useEffect(() => {
    let live = true;
    setPlated(false);
    if (!url) return;
    loadBitmap(url)
      .then((bmp) => {
        const needs = logoNeedsPlateOn(bmp, DARK_SWATCH);
        try { bmp.close(); } catch { /* closed */ }
        if (live) setPlated(needs);
      })
      .catch(() => { /* can't read it — show it plain */ });
    return () => { live = false; };
  }, [url]);

  async function upload(file: File) {
    setBusy("upload");
    setError(null);
    setNote(null);
    setConfirming(false);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/admin/brokers/${brokerId}/logo`, { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Couldn’t upload the logo."); return; }
      setUrl(json.url ?? null);
      setNote("Logo saved.");
      router.refresh();
    } catch {
      setError("Couldn’t upload the logo. Please try again.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy("remove");
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/brokers/${brokerId}/logo`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Couldn’t remove the logo."); return; }
      setUrl(null);
      setConfirming(false);
      setNote("Logo removed.");
      router.refresh();
    } catch {
      setError("Couldn’t remove the logo. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const swatch = "h-20 flex-1 min-w-0 rounded-ctl border flex items-center justify-center p-3 overflow-hidden";

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
      <p className="label-caps mb-1">Logo</p>
      <p className="text-xs text-ink-500 mb-3">Shown on this broker&rsquo;s reels, spec sheets, slideshows and social posts. Transparent PNG works best.</p>

      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <div className={`${swatch} bg-white border-hairline`}>
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Logo on a light background" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-ink-400">No logo yet</span>
          )}
        </div>
        <div className={`${swatch} bg-ink-950 border-ink-950`}>
          {url && plated ? (
            <span
              className="inline-flex items-center justify-center max-w-full"
              style={{ background: LOGO_PLATE_COLOR, padding: Math.round(logoPlateBox(1, PREVIEW_LOGO_H).pad), borderRadius: Math.round(logoPlateBox(1, PREVIEW_LOGO_H).radius) }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Logo on a dark background, on its light plate" className="max-w-full object-contain" style={{ maxHeight: PREVIEW_LOGO_H }} />
            </span>
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Logo on a dark background" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-ink-400">No logo yet</span>
          )}
        </div>
      </div>
      {url && plated && (
        <p className="text-[11px] text-ink-600 mb-1">Dark lettering — shown on a light plate on dark backgrounds.</p>
      )}
      {url && (
        <p className="text-[11px] text-ink-500 mb-3">Left: light backgrounds (slideshow footer, dock card). Right: dark backgrounds (reel end card, spec sheet, social post), exactly as they&rsquo;ll show it.</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className={"cursor-pointer inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet" + (busy ? " opacity-50 pointer-events-none" : "")}>
          {busy === "upload" ? "Uploading…" : url ? "Replace logo" : "Upload logo"}
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={!!busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
          />
        </label>
        {url && !confirming && (
          <button
            onClick={() => { setConfirming(true); setNote(null); setError(null); }}
            disabled={!!busy}
            className="text-xs text-danger-600 hover:text-danger-700 disabled:opacity-50 transition-colors duration-fast ease-quiet"
          >
            Remove
          </button>
        )}
        {url && confirming && (
          <span className="inline-flex items-center gap-3">
            <span className="text-xs text-danger-700">Remove this broker&rsquo;s logo?</span>
            <button
              onClick={remove}
              disabled={!!busy}
              className="text-xs font-semibold bg-danger-600 hover:bg-danger-500 disabled:opacity-60 text-white px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet"
            >
              {busy === "remove" ? "Removing…" : "Yes, remove"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={!!busy}
              className="text-xs text-ink-400 hover:text-ink-600 transition-colors duration-fast ease-quiet"
            >
              Cancel
            </button>
          </span>
        )}
        {note && <span className="text-xs text-success-700">{note}</span>}
        {error && <span className="text-xs text-danger-600">{error}</span>}
      </div>
      <p className="text-[11px] text-ink-500 mt-2">PNG, JPG or WebP, up to 2 MB.</p>
    </div>
  );
}
