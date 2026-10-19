"use client";

import { useEffect, useRef, useState } from "react";
import RetryImg from "@/components/RetryImg";

/**
 * A grid thumbnail. Through RetryImg, so a resize that Supabase answers with a
 * 429 is retried with backoff and, if it still fails, falls back to the
 * full-size original (`fallbackUrl`) instead of sitting broken.
 */
export default function OrientedThumbnail({ url, fallbackUrl, filename }: { url: string | null; fallbackUrl: string | null; filename: string | null }) {
  const [isVertical, setIsVertical] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // onLoad alone misses images that are already cached/complete before React
  // attaches the handler — which left every card defaulting to landscape (4:3)
  // and cropping verticals. Measure on mount too so orientation is always right.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setIsVertical(img.naturalHeight > img.naturalWidth);
    }
  }, [url]);

  return (
    <RetryImg
      ref={ref}
      src={url ?? fallbackUrl ?? undefined}
      fallbackSrc={fallbackUrl ?? undefined}
      alt={filename ?? ""}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={(e) => {
        const img = e.currentTarget;
        setIsVertical(img.naturalHeight > img.naturalWidth);
      }}
      className={`w-full object-cover pointer-events-none ${isVertical ? "aspect-[3/4]" : "aspect-[4/3]"}`}
    />
  );
}
