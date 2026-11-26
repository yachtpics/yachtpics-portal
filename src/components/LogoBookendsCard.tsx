"use client";

import { useEffect, useRef, useState } from "react";
import { loadBitmap } from "@/lib/canvasText";
import { bookendLogoHardToSee, bookendLogoRect } from "@/lib/logoBookends";
import { luminance } from "@/lib/reelStyles";

/**
 * "Open and close with our logo" — the settings card (Nov 25, 2026), shared by
 * Brokerage (the office's set), My Profile (a broker's own) and the admin
 * broker and brokerage pages. Talks to one of the three logo-bookend routes:
 *   GET → { available, own, office? }, POST multipart { which, file },
 *   PATCH { on, ground }, DELETE ?which=
 * Hidden entirely while the feature isn't available (migration not applied).
 *
 * `lockWhenOffice` (My Profile): when the broker's office has its own set on,
 * a read-only line replaces the editor — the office's set is the one used.
 */

export type BookendSettingsView = { on: boolean; openUrl: string | null; closeUrl: string | null; ground: string | null };
export type BookendCardData = {
  available: boolean;
  own: BookendSettingsView | null;
  office?: { name: string; on: boolean } | null;
};

type Which = "open" | "close";

const FRAMES: { label: string; w: number; h: number }[] = [
  { label: "9:16", w: 1080, h: 1920 },
  { label: "1:1", w: 1080, h: 1080 },
  { label: "4:5", w: 1080, h: 1350 },
  { label: "16:9", w: 1920, h: 1080 },
];
const PREVIEW_H = 96;
const DEFAULT_GROUND = "#050b14";
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function hexOrNull(v: string): string | null {
  const t = v.trim();
  if (!HEX_RE.test(t)) return null;
  return (t.startsWith("#") ? t : `#${t}`).toLowerCase();
}

/** Natural size of an image URL (null until loaded or on failure). */
function useNaturalSize(url: string | null): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    setSize(null);
    if (!url) return;
    let live = true;
    const img = new window.Image();
    img.onload = () => { if (live && img.naturalWidth > 0) setSize({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = url;
    return () => { live = false; };
  }, [url]);
  return size;
}

/** Would this logo be hard to see on this colour? Fails quiet (false). */
function useHardToSee(url: string | null, ground: string | null): boolean {
  const [hard, setHard] = useState(false);
  useEffect(() => {
    setHard(false);
    if (!url || !ground) return;
    let live = true;
    loadBitmap(url)
      .then((bmp) => {
        try {
          const k = Math.min(1, 384 / Math.max(bmp.width, bmp.height));
          const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          const cx = c.getContext("2d", { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
          if (cx) {
            cx.imageSmoothingEnabled = true;
            cx.imageSmoothingQuality = "high";
            cx.drawImage(bmp, 0, 0, w, h);
            const res = bookendLogoHardToSee(cx.getImageData(0, 0, w, h).data, w, h, ground);
            if (live) setHard(res);
          }
          c.width = 0; c.height = 0;
        } finally {
          try { bmp.close(); } catch { /* closed */ }
        }
      })
      .catch(() => { /* can't read it — no warning */ });
    return () => { live = false; };
  }, [url, ground]);
  return hard;
}

function FramePreview({ url, size, ground, frame }: { url: string | null; size: { w: number; h: number } | null; ground: string; frame: { label: string; w: number; h: number } }) {
  const k = PREVIEW_H / frame.h;
  const pw = Math.round(frame.w * k);
  const r = size ? bookendLogoRect(frame.w, frame.h, size.w, size.h) : null;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative rounded-[3px] overflow-hidden border border-hairline" style={{ width: pw, height: PREVIEW_H, background: ground }}>
        {url && r && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            className="absolute"
            style={{ left: r.x * k, top: r.y * k, width: r.w * k, height: r.h * k }}
          />
        )}
      </div>
      <span className="text-[10px] text-ink-400">{frame.label}</span>
    </div>
  );
}

export default function LogoBookendsCard({
  endpoint,
  query = "",
  initial,
  title,
  ours = true,
  lockWhenOffice = false,
}: {
  /** One of /api/logo-bookends, /api/brokerage/logo-bookends, /api/admin/logo-bookends. */
  endpoint: string;
  /** Appended to every call, e.g. "?brokerId=…" for the admin route. */
  query?: string;
  /** Server-read settings; left out, the card reads them itself. */
  initial?: BookendCardData | null;
  title: string;
  /** "our logo" (office) or "my logo" (a broker). */
  ours?: boolean;
  lockWhenOffice?: boolean;
}) {
  const [data, setData] = useState<BookendCardData | null>(initial ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hexText, setHexText] = useState<string>(initial?.own?.ground ?? "");
  const openInput = useRef<HTMLInputElement>(null);
  const closeInput = useRef<HTMLInputElement>(null);

  const url = (extra = "") => {
    if (!extra) return `${endpoint}${query}`;
    return `${endpoint}${query}${query.includes("?") ? "&" : "?"}${extra}`;
  };

  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    fetch(url(), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BookendCardData | null) => {
        if (!live || !d) return;
        setData(d);
        setHexText(d.own?.ground ?? "");
      })
      .catch(() => { /* hidden */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, query]);

  const own = data?.own ?? null;
  const ground = own?.ground ?? hexOrNull(hexText) ?? DEFAULT_GROUND;
  const openSize = useNaturalSize(own?.openUrl ?? null);
  const closeSize = useNaturalSize(own?.closeUrl ?? null);
  const openHard = useHardToSee(own?.openUrl ?? null, own?.ground ?? null);
  const closeHard = useHardToSee(own?.closeUrl ?? null, own?.ground ?? null);

  // Save the colour as soon as a full hex is in the box (Nov 25): on a phone
  // the box is often never blurred, so the colour looked set (the previews
  // use it) while nothing was saved and the switch stayed greyed out.
  const typedHex = hexOrNull(hexText);
  const savedGround = own?.ground ?? null;
  const triedHexRef = useRef<string | null>(null); // one attempt per value: a refused save must not retry forever
  useEffect(() => {
    if (!typedHex || typedHex === savedGround || busy || triedHexRef.current === typedHex) return;
    const t = setTimeout(() => { triedHexRef.current = typedHex; void patch({ ground: typedHex }); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedHex, savedGround, busy]);

  if (!data || !data.available || !own) return null;

  const word = ours ? "our" : "my";
  const card = "bg-white border border-hairline rounded-card shadow-elev-1 p-6 mb-5";

  if (lockWhenOffice && data.office?.on) {
    return (
      <section className={card}>
        <h2 className="text-h2 text-ink-900 mb-1">{title}</h2>
        <p className="text-ink-500 text-sm">Your office&rsquo;s logo opens and closes your reels and slideshows (set by {data.office.name}).</p>
      </section>
    );
  }

  function applied(d: { settings?: BookendSettingsView; error?: string } | null, fallback: string) {
    if (d?.settings) {
      setData((prev) => (prev ? { ...prev, own: d.settings! } : prev));
      if (d.settings.ground) setHexText(d.settings.ground);
      return true;
    }
    setError(d?.error ?? fallback);
    return false;
  }

  async function upload(which: Which, file: File) {
    setBusy(`upload-${which}`);
    setError(null);
    try {
      const form = new FormData();
      form.append("which", which);
      form.append("file", file);
      const res = await fetch(url(), { method: "POST", body: form });
      applied(await res.json().catch(() => null), "Couldn’t upload the logo. Please try again.");
    } catch {
      setError("Couldn’t upload the logo. Please try again.");
    } finally {
      setBusy(null);
      const input = which === "open" ? openInput.current : closeInput.current;
      if (input) input.value = "";
    }
  }

  async function remove(which: Which) {
    setBusy(`remove-${which}`);
    setError(null);
    try {
      const res = await fetch(url(`which=${which}`), { method: "DELETE" });
      applied(await res.json().catch(() => null), "Couldn’t remove the logo. Please try again.");
    } catch {
      setError("Couldn’t remove the logo. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function patch(body: { on?: boolean; ground?: string | null }) {
    setBusy("patch");
    setError(null);
    try {
      const res = await fetch(url(), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      applied(await res.json().catch(() => null), "Couldn’t save. Please try again.");
    } catch {
      setError("Couldn’t save. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function commitHex(v: string) {
    const h = hexOrNull(v);
    if (!h) {
      if (v.trim()) setError("Enter the colour as a hex code, like #040847.");
      return;
    }
    if (h === own?.ground) return;
    void patch({ ground: h });
  }

  const hasImage = !!(own.openUrl || own.closeUrl);
  const canTurnOn = hasImage && !!own.ground;
  const hardToSee = openHard || closeHard;

  const tile = (which: Which) => {
    const u = which === "open" ? own.openUrl : own.closeUrl;
    const input = which === "open" ? openInput : closeInput;
    const label = which === "open" ? "Opening logo" : "Closing logo";
    return (
      <div className="flex-1 min-w-[200px]">
        <p className="label-caps text-ink-500 mb-2">{label}</p>
        <div className="h-28 rounded-ctl border border-hairline flex items-center justify-center p-3 overflow-hidden" style={{ background: ground }}>
          {u ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={u} alt={`${label} on the background colour`} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs" style={{ color: luminance(ground) > 0.4 ? "rgba(20,26,33,0.55)" : "rgba(255,255,255,0.6)" }}>No logo yet</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <label className={"cursor-pointer text-sm font-medium text-accent-700 hover:text-accent-600 transition-colors duration-fast ease-quiet" + (busy ? " opacity-50 pointer-events-none" : "")}>
            {busy === `upload-${which}` ? "Uploading…" : u ? "Replace" : "Upload"}
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={!!busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(which, f); }}
            />
          </label>
          {u && (
            <button
              type="button"
              onClick={() => void remove(which)}
              disabled={!!busy}
              className="text-xs text-danger-600 hover:text-danger-700 disabled:opacity-50 transition-colors duration-fast ease-quiet"
            >
              {busy === `remove-${which}` ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-1">
        <h2 className="text-h2 text-ink-900">{title}</h2>
        <button
          type="button"
          role="switch"
          aria-checked={own.on}
          disabled={!!busy || (!own.on && !canTurnOn)}
          onClick={() => void patch({ on: !own.on })}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${own.on ? "bg-success-600" : "bg-ink-200"}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${own.on ? "translate-x-6" : "translate-x-1"}`} />
          <span className="sr-only">Open and close with {word} logo</span>
        </button>
      </div>
      <p className="text-ink-500 text-sm mb-5">
        Every reel starts and ends on your logo, and client slideshows open and close on it. Your photos keep their time; a reel runs about three seconds longer.
      </p>
      {lockWhenOffice === false && data.office?.on && (
        <p className="text-xs text-ink-600 mb-4">Their office&rsquo;s logo is on ({data.office.name}), so the office&rsquo;s is used instead of this one.</p>
      )}

      <div className="flex flex-wrap gap-5 mb-4">
        {tile("open")}
        {tile("close")}
      </div>
      <p className="text-ink-500 text-xs mb-4">A transparent PNG works best. A white logo suits a dark colour. PNG, JPG or WebP, up to 2 MB. One logo alone is used at both ends.</p>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        <label className="label-caps text-ink-500" htmlFor={`bookend-hex-${endpoint}`}>Background colour</label>
        <input
          type="color"
          aria-label="Pick the background colour"
          value={hexOrNull(hexText) ?? ground}
          disabled={!!busy}
          onChange={(e) => setHexText(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          className="h-9 w-9 rounded-ctl border border-hairline cursor-pointer bg-white p-0.5"
        />
        <input
          id={`bookend-hex-${endpoint}`}
          type="text"
          inputMode="text"
          spellCheck={false}
          maxLength={7}
          placeholder="#040847"
          value={hexText}
          disabled={!!busy}
          onChange={(e) => setHexText(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitHex((e.target as HTMLInputElement).value); } }}
          className="w-28 rounded-ctl border border-hairline px-3 py-1.5 text-sm font-mono text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
      </div>
      {hardToSee && (
        <p className="text-xs text-warn-700 mb-2">The logo may be hard to see on this colour.</p>
      )}
      {!own.on && !canTurnOn && (
        <p className="text-xs text-ink-400 mb-2">{hasImage ? "Type the background colour as a hex code, like #040847, to turn this on." : "Upload a logo and pick a colour to turn this on."}</p>
      )}

      {hasImage && (
        <div className="mt-4 space-y-3">
          {([["open", own.openUrl ?? own.closeUrl, own.openUrl ? openSize : closeSize], ["close", own.closeUrl ?? own.openUrl, own.closeUrl ? closeSize : openSize]] as const).map(([which, u, size]) => (
            <div key={which}>
              <p className="text-[11px] text-ink-500 mb-1.5">{which === "open" ? "Opening frame" : "Closing frame"}</p>
              <div className="flex flex-wrap items-end gap-3">
                {FRAMES.map((f) => <FramePreview key={f.label} url={u} size={size} ground={ground} frame={f} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-danger-600 mt-3">{error}</p>}
    </section>
  );
}
