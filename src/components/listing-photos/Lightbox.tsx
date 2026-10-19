"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { ListingPhoto, PhotoVariant } from "./types";

/**
 * Full-screen photo viewer. Render it only while open (index !== null).
 * Arrow keys page, Escape closes.
 *
 *  • broker — a print on paper (ink-50); shows the stored 2000px copy (or the
 *    original), signed on demand for the open photo and its neighbours; swipe
 *    to page on a phone.
 *  • admin — dark, with ↓ Save and a filmstrip; shows the signed original the
 *    server page handed over.
 *
 * Portal to document.body, all layout via inline styles to avoid Tailwind purging.
 */
export function PhotoLightbox(props: {
  variant: PhotoVariant;
  photos: ListingPhoto[];
  index: number;
  setIndex: Dispatch<SetStateAction<number | null>>;
  /** broker: display copies already signed, by photo id. */
  displayCopies?: Record<string, string>;
  /** broker: sign display copies for these photos (cached by the caller). */
  signDisplayCopies?: (targets: ListingPhoto[], expiresIn: number) => Promise<Record<string, string>>;
  /** admin: filmstrip thumbnails. */
  thumbs?: Record<string, string>;
  /** admin: ↓ Save for the open photo. */
  onSave?: (photo: ListingPhoto) => void;
  saveLocked?: boolean;
}) {
  const { variant, photos, index, setIndex } = props;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") setIndex((i) => (i !== null ? Math.max(0, i - 1) : null));
      if (e.key === "ArrowRight") setIndex((i) => (i !== null ? Math.min(photos.length - 1, i + 1) : null));
      if (e.key === "Escape") setIndex(null);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [photos.length, setIndex]);

  if (!mounted) return null;
  return createPortal(
    variant === "broker" ? <BrokerLightbox {...props} /> : <AdminLightbox {...props} />,
    document.body
  );
}

type Props = Parameters<typeof PhotoLightbox>[0];

function BrokerLightbox({ photos, index, setIndex, displayCopies = {}, signDisplayCopies }: Props) {
  const [touchX, setTouchX] = useState<number | null>(null);

  // Sign the open photo's display copy (and its neighbours) only when the
  // lightbox needs them — not every original up front on page load.
  useEffect(() => {
    if (!signDisplayCopies) return;
    const need = [index, index - 1, index + 1]
      .map((i) => photos[i])
      .filter((p): p is ListingPhoto => !!p && !displayCopies[p.id]);
    if (need.length) signDisplayCopies(need, 3600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, photos]);

  // Warm the neighbouring photos so paging feels instant.
  useEffect(() => {
    [index - 1, index + 1].forEach((i) => {
      const p = photos[i];
      const url = p ? displayCopies[p.id] : undefined;
      if (url) {
        const img = new window.Image();
        img.decoding = "async";
        img.src = url;
      }
    });
  }, [index, photos, displayCopies]);

  const photo = photos[index];
  return (
    // A print on paper (ink-50): the counter and a single hairline are the only chrome on screen.
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--ink-50)", display: "flex", flexDirection: "column" }}
      onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX === null) return;
        const diff = touchX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 50) {
          if (diff > 0) setIndex((i) => (i !== null ? Math.min(photos.length - 1, i + 1) : null));
          else setIndex((i) => (i !== null ? Math.max(0, i - 1) : null));
        }
        setTouchX(null);
      }}
    >
      {/* Header — counter above a single hairline */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px 6px 20px", flexShrink: 0, borderBottom: "1px solid var(--hairline)" }}>
        <span style={{ color: "var(--ink-600)", fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" }}>
          {photo?.category ? `${photo.category} · ` : ""}{index + 1} / {photos.length}
        </span>
        <button
          onClick={() => setIndex(null)}
          aria-label="Close"
          style={{ color: "var(--ink-700)", fontSize: 26, lineHeight: 1, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", border: "1px solid var(--hairline)", borderRadius: "50%", boxShadow: "var(--shadow-elev-1)", cursor: "pointer" }}
        >
          ×
        </button>
      </div>

      {/* Photo area — fills remaining height; the print floats on the paper, lifted by its shadow */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {photo && displayCopies[photo.id] && (
          <LightboxPhoto key={photo.id} src={displayCopies[photo.id]} alt={photo.filename ?? ""} />
        )}
        {index > 0 && (
          <button onClick={() => setIndex((i) => (i !== null ? i - 1 : null))}
            aria-label="Previous photo"
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", background: "#fff", border: "1px solid var(--hairline)", borderRadius: "50%", width: 44, height: 44, color: "var(--ink-700)", fontSize: 24, boxShadow: "var(--shadow-elev-1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            ‹
          </button>
        )}
        {index < photos.length - 1 && (
          <button onClick={() => setIndex((i) => (i !== null ? i + 1 : null))}
            aria-label="Next photo"
            style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "#fff", border: "1px solid var(--hairline)", borderRadius: "50%", width: 44, height: 44, color: "var(--ink-700)", fontSize: 24, boxShadow: "var(--shadow-elev-1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            ›
          </button>
        )}
      </div>
    </div>
  );
}

function AdminLightbox({ photos, index, setIndex, thumbs = {}, onSave, saveLocked = false }: Props) {
  const photo = photos[index];
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.97)", display: "flex", flexDirection: "column" }}
      onClick={() => setIndex(null)}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", flexShrink: 0 }}>
        <span style={{ color: "#9ca3af", fontSize: 14 }}>
          {photo?.category ? `${photo.category} · ` : ""}{index + 1} / {photos.length}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {photo && onSave && (
            <button
              onClick={(e) => { e.stopPropagation(); onSave(photo); }}
              disabled={saveLocked}
              style={{ color: "#fff", background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 6, fontSize: 14, padding: "8px 12px", cursor: "pointer", opacity: saveLocked ? 0.5 : 1 }}
            >↓ Save</button>
          )}
          <button onClick={() => setIndex(null)}
            style={{ color: "#fff", background: "none", border: "none", fontSize: 28, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "0 48px" }}
        onClick={(e) => e.stopPropagation()}>
        {photo?.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt={photo.filename ?? ""}
            style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", display: "block" }} />
        )}
        {index > 0 && (
          <button onClick={() => setIndex((i) => (i !== null ? i - 1 : null))}
            style={{ position: "absolute", left: 8, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 40, height: 40, color: "#fff", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
        )}
        {index < photos.length - 1 && (
          <button onClick={() => setIndex((i) => (i !== null ? i + 1 : null))}
            style={{ position: "absolute", right: 8, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 40, height: 40, color: "#fff", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 16px", flexShrink: 0 }}>
        {photos.map((p, i) => (
          <button key={p.id} onClick={(e) => { e.stopPropagation(); setIndex(i); }}
            style={{ flexShrink: 0, borderRadius: 4, overflow: "hidden", border: "none", cursor: "pointer", opacity: i === index ? 1 : 0.4, outline: i === index ? "2px solid var(--accent)" : "none" }}>
            {/* Filmstrip renders at 56px — the resized version is plenty. */}
            {(thumbs[p.id] ?? p.url) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbs[p.id] ?? p.url!} alt="" loading="lazy" decoding="async" style={{ width: 56, height: 36, objectFit: "cover", display: "block" }} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// Raw <img> on purpose (time-limited signed URLs — never next/image). Fades in
// once decoded; inline styles because this renders inside a body portal.
// The print sizes to its content so the shadow hugs the photograph itself;
// padding stays minimal so the image claims the viewport.
function LightboxPhoto({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        decoding="async"
        ref={(el) => { if (el && el.complete && el.naturalWidth > 0) setLoaded(true); }}
        onLoad={() => setLoaded(true)}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: 2,
          boxShadow: "var(--shadow-print)",
          opacity: loaded ? 1 : 0,
          transition: "opacity 160ms cubic-bezier(0.25, 0, 0.15, 1)",
        }}
      />
    </div>
  );
}
