"use client";

/**
 * A plain <img> that quietly retries itself when a thumbnail fails to load.
 *
 * Thumbnails now come from Supabase's image transformation endpoint, and the
 * first request for a given size has to render the resize on the fly. When a
 * listing paints a couple of hundred of those at once, Supabase sometimes
 * answers 429 "SlowDown" or drops one — and a normal <img> that fails once
 * stays a broken square until the whole page is reloaded. Retrying with a
 * widening gap, and a cache-busting param so the browser doesn't just replay
 * its own cached failure, turns that into a thumbnail that arrives a moment
 * late instead of not at all.
 */

import { forwardRef, useEffect, useRef, useState } from "react";

type RetryImgProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  /** How many times to re-request before giving up. Backoff doubles from
   *  ~700ms with random jitter, so a page full of failed thumbnails doesn't
   *  retry in one synchronised burst and trip the same 429 again. */
  retries?: number;
  /** Used once every retry has failed (e.g. the full-size original), so the
   *  slot shows the photo instead of a broken icon and its filename. */
  fallbackSrc?: string;
};

const RetryImg = forwardRef<HTMLImageElement, RetryImgProps>(function RetryImg(
  { retries = 6, src, fallbackSrc, alt = "", onError, onLoad, ...rest },
  ref,
) {
  const [attempt, setAttempt] = useState(0);
  const [lastSrc, setLastSrc] = useState(src);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new photo in this slot starts with a fresh budget of retries, and any
  // retry still queued for the old one is dropped. Done during render rather
  // than in an effect so we never paint the new src carrying the old src's
  // cache-busting param.
  if (lastSrc !== src) {
    setLastSrc(src);
    setAttempt(0);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Signed URLs already carry a query string, so in practice this appends.
  const exhausted = attempt > retries;
  const url = exhausted && fallbackSrc
    ? fallbackSrc
    : src && attempt > 0 ? `${src}${src.includes("?") ? "&" : "?"}r=${attempt}` : src;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      ref={ref}
      src={url}
      alt={alt}
      onLoad={onLoad}
      onError={(e) => {
        if (src && attempt < retries) {
          const next = attempt + 1;
          if (timer.current) clearTimeout(timer.current);
          const wait = Math.min(700 * 2 ** attempt, 12000) * (0.6 + Math.random() * 0.8);
          timer.current = setTimeout(() => setAttempt(next), wait);
        } else if (src && fallbackSrc && attempt === retries) {
          // Out of retries: switch to the fallback once.
          setAttempt(retries + 1);
        }
        onError?.(e);
      }}
    />
  );
});

export default RetryImg;
