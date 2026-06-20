"use client";

import { useState } from "react";

const NAVY = "#050b14";

// Shows the hero photo in full — never cropped — whatever its shape.
// The image is scaled to fit, centered on the brand navy. Height is capped per
// orientation so the flyer always stays on one page: portraits can run a little
// taller (they're narrow), landscapes are kept a touch shorter.
export default function HeroImage({ src, alt }: { src: string; alt: string }) {
  const [aspect, setAspect] = useState<number | null>(null);

  // Until measured, assume landscape (the common case) to avoid a layout flash.
  const tall = aspect !== null && aspect < 1;
  const maxH = tall ? "4.9in" : "4.5in";

  return (
    <div style={{ background: NAVY, display: "flex", justifyContent: "center", alignItems: "center", width: "100%" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight);
        }}
        style={{ maxWidth: "100%", maxHeight: maxH, width: "auto", height: "auto", display: "block", margin: "0 auto" }}
      />
    </div>
  );
}
