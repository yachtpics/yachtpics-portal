"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps a public page's signed photo/video links alive.
 *
 * The public pages sign their links for two hours. A buyer who leaves the
 * slideshow open in a tab and comes back later used to find it black — every
 * link had expired and nothing noticed. This hook re-asks the server for a
 * fresh set (POST `endpoint`, which re-runs the page's own access checks):
 *
 *  - when the tab becomes visible again (or is restored from the back/forward
 *    cache) and the links are older than ~100 minutes, and
 *  - when an image or video fails AND the links are old enough that expiry is
 *    the likely cause. A failure on fresh links is a Supabase hiccup or a 429,
 *    which the image's own retry handles; re-signing then would just reset
 *    every tile at once and make the burst worse.
 *
 * Never more than one request in flight, and at least 20 s between attempts.
 */

const STALE_MS = 100 * 60 * 1000;
const ERROR_MIN_AGE_MS = 30 * 60 * 1000;
const MIN_GAP_MS = 20 * 1000;

export function useSelfRefreshingUrls<T>(initial: T, endpoint: string): {
  data: T;
  /** Call from an image/video onError. Cheap; safe to call many times. */
  onMediaError: () => void;
} {
  const [data, setData] = useState<T>(initial);
  const signedAt = useRef<number>(Date.now());
  const lastTry = useRef<number>(0);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    const now = Date.now();
    if (inflight.current || now - lastTry.current < MIN_GAP_MS) return;
    inflight.current = true;
    lastTry.current = now;
    try {
      const res = await fetch(endpoint, { method: "POST", cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as T;
      signedAt.current = Date.now();
      setData(next);
    } catch {
      /* offline at the dock — the next visibility change or error tries again */
    } finally {
      inflight.current = false;
    }
  }, [endpoint]);

  useEffect(() => {
    const maybeRefresh = () => {
      if (document.visibilityState === "visible" && Date.now() - signedAt.current > STALE_MS) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", maybeRefresh);
    window.addEventListener("pageshow", maybeRefresh);
    return () => {
      document.removeEventListener("visibilitychange", maybeRefresh);
      window.removeEventListener("pageshow", maybeRefresh);
    };
  }, [refresh]);

  const onMediaError = useCallback(() => {
    if (Date.now() - signedAt.current > ERROR_MIN_AGE_MS) void refresh();
  }, [refresh]);

  return { data, onMediaError };
}
