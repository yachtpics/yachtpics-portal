"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Display links for the public slideshow / gallery, fetched progressively and
 * kept alive.
 *
 * WHY PROGRESSIVE: Supabase signs a resized link one photo at a time. Signing
 * a whole 257-photo boat (× two sizes) while rendering the page took the buyer
 * slideshow from 0.5 s to 15 s. So the page signs only the opening photo and
 * the first dozen tiles; everything else is asked for here, in chunks of ≤ 60
 * ids at ONE size (`POST endpoint {ids, size}`), just ahead of need. Until a
 * link arrives the tile shows its normal placeholder.
 *
 * WHY SELF-REFRESHING: links live two hours. When the tab comes back (or is
 * restored from the back/forward cache) after ~100 min, or an image fails on
 * links older than 30 min, every link we hold is re-asked for (same route,
 * same chunks) plus the video/deck-plan links (`POST endpoint {}`). A failure
 * on fresh links is a Supabase hiccup or a 429 — RetryImg handles those.
 *
 * Calls run one at a time; slide-size requests jump the queue.
 */

export type PhotoSize = "thumb" | "full";
export type ClientPhotoUrls = Record<string, { thumb?: string | null; full?: string | null }>;

const STALE_MS = 100 * 60 * 1000;
const ERROR_MIN_AGE_MS = 30 * 60 * 1000;
const MIN_REFRESH_GAP_MS = 20 * 1000;
const CHUNK = 60;
const COALESCE_MS = 80;

export function useProgressivePhotoUrls<E>(opts: {
  endpoint: string;
  initialPhotos: ClientPhotoUrls;
  initialExtras: E;
}): {
  photos: ClientPhotoUrls;
  extras: E;
  /** Ask for links (no-op for ones already held or already on the way). */
  want: (ids: string[], size: PhotoSize) => void;
  /** Call from an image/video onError. Cheap; safe to call many times. */
  onMediaError: () => void;
} {
  const { endpoint } = opts;
  const [photos, setPhotos] = useState<ClientPhotoUrls>(opts.initialPhotos);
  const [extras, setExtras] = useState<E>(opts.initialExtras);
  const photosRef = useRef<ClientPhotoUrls>(opts.initialPhotos);
  const pending = useRef<Set<string>>(new Set());
  // Asked and answered (even if the server had no link — e.g. a file missing
  // from storage). Not asked again until a refresh, so a missing photo can't
  // set off a request loop.
  const answered = useRef<Set<string>>(new Set());
  const failures = useRef<Map<string, number>>(new Map());
  const queue = useRef<{ full: string[]; thumb: string[] }>({ full: [], thumb: [] });
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signedAt = useRef<number>(Date.now());
  const lastRefresh = useRef<number>(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const merge = useCallback((incoming: ClientPhotoUrls) => {
    if (Object.keys(incoming).length === 0) return;
    const next: ClientPhotoUrls = { ...photosRef.current };
    for (const [id, v] of Object.entries(incoming)) next[id] = { ...next[id], ...v };
    photosRef.current = next;
    if (mounted.current) setPhotos(next);
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const size: PhotoSize | null = queue.current.full.length ? "full" : queue.current.thumb.length ? "thumb" : null;
        if (!size) break;
        const ids = queue.current[size].splice(0, CHUNK);
        let ok = false;
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids, size }),
            cache: "no-store",
          });
          if (res.ok) {
            const data = (await res.json()) as { photos?: ClientPhotoUrls };
            merge(data.photos ?? {});
            ok = true;
          }
        } catch {
          /* offline / dropped — retried below */
        }
        ids.forEach((id) => pending.current.delete(`${size}:${id}`));
        if (ok) {
          ids.forEach((id) => answered.current.add(`${size}:${id}`));
        } else {
          // Back off and try this chunk again later — at most 3 times.
          const retryIds = ids.filter((id) => {
            const key = `${size}:${id}`;
            const n = (failures.current.get(key) ?? 0) + 1;
            failures.current.set(key, n);
            return n <= 3;
          });
          if (retryIds.length) {
            setTimeout(() => { if (mounted.current) wantRef.current(retryIds, size); }, 4000);
          }
        }
      }
    } finally {
      running.current = false;
    }
  }, [endpoint, merge]);

  const enqueue = useCallback((ids: string[], size: PhotoSize, force: boolean) => {
    let added = false;
    for (const id of ids) {
      const key = `${size}:${id}`;
      if (pending.current.has(key)) continue;
      if (!force && (photosRef.current[id]?.[size] || answered.current.has(key))) continue;
      pending.current.add(key);
      queue.current[size].push(id);
      added = true;
    }
    if (added && !timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        void drain();
      }, COALESCE_MS);
    }
  }, [drain]);

  const want = useCallback((ids: string[], size: PhotoSize) => enqueue(ids, size, false), [enqueue]);
  const wantRef = useRef(want);
  wantRef.current = want;

  const refresh = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefresh.current < MIN_REFRESH_GAP_MS) return;
    lastRefresh.current = now;
    signedAt.current = now;
    answered.current.clear();
    failures.current.clear();
    // Re-ask for every link we hold, slide sizes first.
    const held = photosRef.current;
    enqueue(Object.keys(held).filter((id) => held[id]?.full), "full", true);
    enqueue(Object.keys(held).filter((id) => held[id]?.thumb), "thumb", true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as E & { photos?: unknown };
        const rest = { ...(data as Record<string, unknown>) };
        delete rest.photos;
        if (mounted.current) setExtras((prev) => ({ ...prev, ...(rest as Partial<E>) }));
      }
    } catch {
      /* next visibility change or error tries again */
    }
  }, [endpoint, enqueue]);

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

  return { photos, extras, want, onMediaError };
}
