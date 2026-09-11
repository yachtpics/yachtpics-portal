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
  /** How many times to re-request before giving up. Waits 600ms, 1.2s, 2.4s. */
  retries?: number;
};

const RetryImg = forwardRef<HTMLImageElement, RetryImgProps>(function RetryImg(
  { retries = 3, src, alt = "", onError, onLoad, ...rest },
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
  const url =
    src && attempt > 0 ? `${src}${src.includes("?") ? "&" : "?"}r=${attempt}` : src;

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
          timer.current = setTimeout(() => setAttempt(next), 600 * 2 ** attempt);
        }
        onError?.(e);
      }}
    />
  );
});

export default RetryImg;
