"use client";

import { useState } from "react";

const MATTE = "#ffffff";
// On paper, depth comes from a keyline, not a shadow — drop shadows print as
// muddy grey. A 1px ink-300 hairline frames the photo against the white matte.
const KEYLINE = "1px solid #c5cbd2";

// Renders the flyer hero in one of two modes:
//  • "fit"  — shows the whole photo, never cropped, centered on a white matte.
//             Height is capped per orientation so the flyer stays one page.
//  • "fill" — fills the band edge-to-edge (cropping as needed). Best when you'd
//             rather a vertical photo use the full width than show a matte.
export default function HeroImage({ src, alt, fit = "fit" }: { src: string; alt: string; fit?: "fit" | "fill" }) {
  const [aspect, setAspect] = useState<number | null>(null);

  if (fit === "fill") {
    return (
      <div style={{ background: MATTE, width: "100%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} style={{ width: "100%", height: "4in", objectFit: "cover", display: "block", borderTop: KEYLINE, borderBottom: KEYLINE, boxSizing: "border-box" }} />
      </div>
    );
  }

  // Until measured, assume landscape (the common case) to avoid a layout flash.
  const tall = aspect !== null && aspect < 1;
  const maxH = tall ? "4.9in" : "4.5in";

  return (
    <div style={{ background: MATTE, display: "flex", justifyContent: "center", alignItems: "center", width: "100%" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight);
        }}
        style={{ maxWidth: "100%", maxHeight: maxH, width: "auto", height: "auto", display: "block", margin: "0 auto", border: KEYLINE, boxSizing: "border-box" }}
      />
    </div>
  );
}
