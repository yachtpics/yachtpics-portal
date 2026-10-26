"use client";

import { useEffect, useState } from "react";

/**
 * Showroom hero: crossfades through up to five boat covers. Every image is in
 * the page from the start (stacked, opacity only) so nothing shifts; with
 * prefers-reduced-motion the first photo simply stays.
 */
export default function ShowroomSlides({ urls }: { urls: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (urls.length < 2) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reduce?.matches) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % urls.length), 6500);
    return () => window.clearInterval(t);
  }, [urls.length]);
  return (
    <>
      {urls.map((u, n) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={u}
          src={u}
          alt=""
          loading={n === 0 ? "eager" : "lazy"}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-[1800ms] ease-quiet motion-reduce:transition-none"
          style={{ opacity: n === i ? 1 : 0 }}
        />
      ))}
    </>
  );
}
