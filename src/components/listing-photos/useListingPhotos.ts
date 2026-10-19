"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import { derivativePath, hasDerivatives } from "@/lib/photoDerivativePaths";
import type { ListingPhoto, PhotoCapabilities } from "./types";

/**
 * The photo state a listing page keeps: the rows, their resized thumbnails
 * (/api/thumbs), which files are missing, the lightbox display copies signed
 * on demand, the cover photo, custom categories and whether AI labelling is
 * available. Data in, nothing rendered.
 */
export function useListingPhotos(opts: {
  supabase: SupabaseClient;
  listingId: string;
  caps: PhotoCapabilities;
  /** Admin: rows from the server page. Broker: empty, then setPhotos() once loaded. */
  initialPhotos?: ListingPhoto[];
  initialHeroPhotoId?: string | null;
  /** Admin: every custom category in use (from the server page). */
  initialCustomCategories?: string[];
}) {
  const { supabase, listingId, caps } = opts;
  const [photos, setPhotos] = useState<ListingPhoto[]>(opts.initialPhotos ?? []);
  const [heroPhotoId, setHeroPhotoId] = useState<string | null>(opts.initialHeroPhotoId ?? null);
  // Resized thumbnails, keyed by photo id. Fetched once in the background; a
  // tile shows a skeleton (broker) or the original (admin) until its url
  // arrives, so nothing blocks.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  // Photos whose file isn't in storage (reported by /api/thumbs) — the broker
  // tile shows "File missing" for these.
  const [missingIds, setMissingIds] = useState<Set<string>>(new Set());
  // Lightbox display copies (the stored 2000px WebP, or the original when a
  // photo has none yet), signed only when someone needs one. Cached per photo
  // id. Downloads always sign fresh links instead, so a page left open for
  // hours still downloads.
  const [originals, setOriginals] = useState<Record<string, string>>({});
  const [customCategories, setCustomCategories] = useState<string[]>(opts.initialCustomCategories ?? []);
  // AI photo labelling — on only when the server has a key. Checked once.
  const [aiConfigured, setAiConfigured] = useState(false);

  useEffect(() => {
    fetch("/api/photos/categorize").then((r) => (r.ok ? r.json() : null)).then((d) => setAiConfigured(!!d?.configured)).catch(() => {});
  }, []);

  // Custom categories saved from the Photo Categories page (broker page).
  useEffect(() => {
    if (caps.customCategorySource !== "api") return;
    fetch("/api/photo-categories")
      .then((r) => r.json())
      .then((d: { categories?: { id: string; name: string }[] }) => {
        if (d.categories) setCustomCategories(d.categories.map((c) => c.name));
      })
      .catch(() => {});
  }, [caps.customCategorySource]);

  /** Add a typed-in category to the master list (broker page). */
  async function saveCustomCategory(name: string) {
    if (caps.customCategorySource !== "api") return;
    if ((PHOTO_CATEGORIES as readonly string[]).includes(name)) return;
    if (customCategories.includes(name)) return;
    try {
      const res = await fetch("/api/photo-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (res.ok && !data.skipped) {
        setCustomCategories((prev) => (prev.includes(name) ? prev : [...prev, name].sort((a, b) => a.localeCompare(b))));
      }
    } catch {}
  }

  // Thumbnails are requested the instant the page mounts, alongside everything
  // else — not after. They only need the listing id, so there is nothing to
  // wait on. Re-run after an upload: a photo added after page load has no
  // signed thumbnail until the list is fetched again.
  const refreshThumbs = useCallback(() => {
    fetch("/api/thumbs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId, width: 400 }),
    })
      .then((r) => (r.ok ? r.json() : null))
      // Keep URLs already on screen (re-signing them would make every
      // thumbnail reload); only photos new since the last fetch get one.
      .then((d) => {
        if (d?.urls) setThumbs((prev) => ({ ...d.urls, ...prev }));
        if (Array.isArray(d?.missing)) setMissingIds(new Set<string>(d.missing));
      })
      .catch(() => { /* thumbnails are an optimisation, never a blocker */ });
  }, [listingId]);
  useEffect(() => { refreshThumbs(); }, [refreshThumbs]);

  /**
   * Sign the lightbox's display copy for these photos in one request, matched
   * by path (not index): the stored 2000px WebP when the photo has one (a few
   * hundred KB instead of a 10–20 MB original), otherwise the original.
   * Downloads never use this. Caches the result for the lightbox.
   */
  async function signDisplayCopies(targets: ListingPhoto[], expiresIn: number): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (targets.length === 0) return out;
    const pathFor = (t: ListingPhoto) => (hasDerivatives(t) ? derivativePath(t, 2000) : t.storage_path);
    const { data } = await supabase.storage
      .from("listing-photos")
      .createSignedUrls(targets.map(pathFor), expiresIn);
    const byPath = new Map<string, string>();
    (data ?? []).forEach((d) => { if (d.path && d.signedUrl && !d.error) byPath.set(d.path, d.signedUrl); });
    targets.forEach((t) => { const u = byPath.get(pathFor(t)); if (u) out[t.id] = u; });
    // A stored copy that couldn't be signed (object missing): try the original.
    const retry = targets.filter((t) => !out[t.id] && hasDerivatives(t));
    if (retry.length) {
      const { data: again } = await supabase.storage
        .from("listing-photos")
        .createSignedUrls(retry.map((t) => t.storage_path), expiresIn);
      const byPath2 = new Map<string, string>();
      (again ?? []).forEach((d) => { if (d.path && d.signedUrl && !d.error) byPath2.set(d.path, d.signedUrl); });
      retry.forEach((t) => { const u = byPath2.get(t.storage_path); if (u) out[t.id] = u; });
    }
    if (Object.keys(out).length) setOriginals((prev) => ({ ...prev, ...out }));
    return out;
  }

  return {
    photos, setPhotos,
    heroPhotoId, setHeroPhotoId,
    thumbs, setThumbs,
    missingIds, setMissingIds,
    originals, setOriginals,
    customCategories, setCustomCategories, saveCustomCategory,
    aiConfigured,
    refreshThumbs,
    signDisplayCopies,
  };
}

export type ListingPhotosState = ReturnType<typeof useListingPhotos>;
