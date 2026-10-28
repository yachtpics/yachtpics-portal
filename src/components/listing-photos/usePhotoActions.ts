"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import { orderPhotos } from "@/lib/photoOrder";
import { guessCategory } from "@/lib/guessCategory";
import { expandPickedFiles } from "@/lib/pickedImages";
import { reorderPhotos } from "@/lib/reorderPhotos";
import {
  runPool, uploadListingPhoto, replaceListingPhoto, photoUploadConcurrency,
} from "@/lib/uploadListingPhoto";
import type { ListingPhoto, OnPhotoMessage, PhotoCapabilities, ReplaceStage } from "./types";
import type { ListingPhotosState } from "./useListingPhotos";
import { signOriginalInBrowser } from "@/lib/photoStoreClient";

/**
 * Everything a person can do to a listing's photos — upload (4 at a time, with
 * Retry for failures), replace, delete (one / selected / all), drag reorder,
 * Sort to standard order, categories (one / bulk), cover, show/hide and AI
 * labels — plus the select-mode state. One copy for the broker and admin
 * listing pages; `caps` carries the role differences and `onMessage` hands
 * every confirmation or failure to the page's own banner.
 *
 * Every API call here is the same route and payload the pages sent before
 * this was shared, so nothing changes on the server.
 */
export function usePhotoActions(opts: {
  supabase: SupabaseClient;
  listingId: string;
  caps: PhotoCapabilities;
  state: ListingPhotosState;
  onMessage: OnPhotoMessage;
  /**
   * First folder of new storage paths (uploads and replaces). Admin: the
   * listing's broker. Broker page: the signed-in uploader. Return null to stop
   * (signed out).
   */
  ownerFolder: (userId: string | null) => string | null;
}) {
  const { supabase, listingId, caps, state, onMessage, ownerFolder } = opts;
  const { photos, setPhotos, setThumbs, setOriginals, setMissingIds, refreshThumbs } = state;
  const isAdmin = caps.variant === "admin";

  // ── Select mode ──────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkCategorizing, setBulkCategorizing] = useState(false);

  function toggleSelect(photoId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId); else next.add(photoId);
      return next;
    });
  }
  /** Broker: every visible photo (what downloads include). Admin: every photo. */
  function selectAll() {
    setSelectedIds(new Set(photos.filter((p) => isAdmin || p.is_visible).map((p) => p.id)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
    setSelectMode(false);
    setBulkCategory("");
  }

  // ── AI labels ────────────────────────────────────────────────────────────
  const [labeling, setLabeling] = useState(false);
  const [labelNote, setLabelNote] = useState<string | null>(null);

  /**
   * Ask the vision model to label photos that are still "Other" (or, with
   * `force`, everything a person hasn't set by hand). Updates the grid in
   * place. Quiet on failure — labelling is a convenience, never a blocker.
   */
  async function labelWithAi(photoIds?: string[], force = false): Promise<number> {
    if (!state.aiConfigured) return 0;
    setLabeling(true);
    setLabelNote(null);
    try {
      const res = await fetch("/api/photos/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(photoIds ? { listingId, photoIds, force } : { listingId, force }),
      });
      const data = await res.json().catch(() => ({}));
      const updated: { id: string; category: string }[] = data?.updated ?? [];
      if (updated.length) {
        const map = new Map(updated.map((u) => [u.id, u.category]));
        setPhotos((prev) => prev.map((p) => (map.has(p.id) ? { ...p, category: map.get(p.id)! } : p)));
      }
      const noun = isAdmin ? "" : ` photo${updated.length === 1 ? "" : "s"}`;
      if (!res.ok && data?.error) setLabelNote(`Labelling stopped: ${data.error}`);
      else if (data?.considered === 0) setLabelNote("Nothing left to label.");
      else setLabelNote(`${updated.length}${noun} labelled${data?.unsure ? ` · ${data.unsure} left as Other` : ""}.`);
      setTimeout(() => setLabelNote(null), 5000);
      return updated.length;
    } catch {
      return 0;
    } finally {
      setLabeling(false);
    }
  }

  // ── Upload ───────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Same handler, but the input has no `accept`, so Android opens the Files app (Downloads, zips) instead of its Gallery picker. */
  const anyFileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  // Photos whose upload failed in the last batch — kept so Retry can re-run
  // just those (with the category the person picked for them, if any).
  const [uploadFailed, setUploadFailed] = useState<{ files: File[]; ok: number; override: string | null } | null>(null);
  // Category prompt — files the filename can't place, held until a category
  // is picked (broker page, only when AI labelling is off).
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [pendingCategory, setPendingCategory] = useState("Other");

  // Leaving mid-batch abandons the rest of the uploads — warn first.
  useEffect(() => {
    if (!uploading) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [uploading]);

  function handleFiles(files: FileList | File[] | null) {
    if (!files || uploadingRef.current) return;
    void expandPickedFiles(files).then((all) => { if (all.length > 0) handleImageFiles(all); });
  }

  function handleImageFiles(fileArr: File[]) {
    // If any files can't be auto-categorized, prompt before uploading — unless
    // the model can label them after upload, in which case just go.
    if (caps.promptForUncategorized && !state.aiConfigured && fileArr.some((f) => guessCategory(f.name) === "Other")) {
      setPendingFiles(fileArr);
      setPendingCategory("Other");
      return;
    }
    void doUpload(fileArr, null);
  }

  async function doUpload(fileArr: File[], overrideCategory: string | null) {
    if (uploadingRef.current || fileArr.length === 0) return;
    uploadingRef.current = true; // a second click can't start a second batch
    setPendingFiles(null);
    // Stamp WHICH person uploaded these (admins too — the by-YachtPics checks
    // look the role up by id, so a stamped admin still counts as ours).
    const { data: { user } } = await supabase.auth.getUser();
    const folder = ownerFolder(user?.id ?? null);
    if (!folder) { uploadingRef.current = false; return; }

    setUploading(true);
    setUploadProgress(0);
    setUploadFailed(null);

    // Order is fixed up front from the files' own order, so running four at a
    // time can't shuffle display_order by whichever finishes first.
    const baseOrder = photos.length;
    const stamp = Date.now();
    const results: (ListingPhoto | null)[] = fileArr.map(() => null);
    const failedIdx: number[] = [];
    const needsLabel: string[] = [];
    let done = 0;

    try {
      await runPool(fileArr, photoUploadConcurrency(fileArr), async (file, i) => {
        const guessed = guessCategory(file.name);
        const usedOverride = !!overrideCategory && guessed === "Other";
        const category = usedOverride ? overrideCategory! : guessed;
        const r = await uploadListingPhoto({
          supabase,
          file,
          brokerId: folder,
          listingId,
          pathKey: `${stamp}-${i}`,
          category,
          categorySource: caps.recordCategorySource ? (usedOverride ? "manual" : "filename") : undefined,
          displayOrder: baseOrder + i,
          uploadedBy: user?.id ?? null,
        }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
        if (r.ok) {
          const photo: ListingPhoto = { ...r.row };
          if (caps.keepOriginalUrls) {
            photo.url = await signOriginalInBrowser(supabase, r.row.storage_path, 3600);
          }
          results[i] = photo;
          setPhotos((prev) => [...prev, photo]);
          // Original on R2: its 600 px tile appears as soon as it's made.
          r.thumb?.then((tile) => { if (tile) setThumbs((prev) => ({ ...prev, [photo.id]: tile })); });
          if (category === "Other") needsLabel.push(photo.id);
        } else {
          failedIdx.push(i);
        }
        done++;
        setUploadProgress(Math.round((done / fileArr.length) * 100));
      });
    } finally {
      uploadingRef.current = false;
    }

    // New photos appeared in finishing order; put them back in file order.
    const added = results.filter((x): x is ListingPhoto => x !== null);
    const addedIds = new Set(added.map((x) => x.id));
    setPhotos((prev) => [...prev.filter((x) => !addedIds.has(x.id)), ...added]);

    setUploading(false);
    refreshThumbs();
    if (failedIdx.length === 0) {
      onMessage({ kind: "success", text: `${added.length} photo${added.length !== 1 ? "s" : ""} uploaded.`, ms: 3000 });
    } else {
      failedIdx.sort((a, b) => a - b);
      setUploadFailed({ files: failedIdx.map((i) => fileArr[i]), ok: added.length, override: overrideCategory });
    }

    // Anything the filename couldn't place, the model labels now.
    if (needsLabel.length && state.aiConfigured) await labelWithAi(needsLabel);
  }

  function retryFailedUploads() {
    if (!uploadFailed) return;
    void doUpload(uploadFailed.files, uploadFailed.override);
  }

  // ── Show / hide ──────────────────────────────────────────────────────────
  async function toggleVisibility(photoId: string, current: boolean) {
    const { error } = await supabase.from("photos").update({ is_visible: !current }).eq("id", photoId);
    if (error) {
      onMessage({ kind: "error", text: `Couldn't ${current ? "hide" : "show"} that photo: ${error.message}`, ms: 5000 });
      return;
    }
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, is_visible: !current } : p)));
  }

  // ── Categories ───────────────────────────────────────────────────────────
  async function updateCategory(photoId: string, category: string, quiet = false): Promise<boolean> {
    let failure: string | null = null;
    if (caps.categoryWrite === "admin-api") {
      try {
        const res = await fetch("/api/admin/photos/update-category", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoId, category }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          failure = data.error ?? "Unknown error";
        }
      } catch (e) {
        failure = e instanceof Error ? e.message : "Unknown error";
      }
    } else {
      // A category a person chose is never overwritten by the model.
      const { error } = await supabase.from("photos").update({ category, category_source: "manual" }).eq("id", photoId);
      if (error) failure = error.message;
    }
    if (failure) {
      if (!quiet) onMessage({ kind: "error", text: "Failed to save category: " + failure, ms: 4000 });
      return false;
    }
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, category } : p)));
    // Admin: a non-standard category joins the list so other photos can pick it.
    // (The broker page saves typed-in ones to /api/photo-categories instead.)
    if (caps.customCategorySource === "props" && !(PHOTO_CATEGORIES as readonly string[]).includes(category)) {
      state.setCustomCategories((prev) => (prev.includes(category) ? prev : [...prev, category]));
    }
    return true;
  }

  // Set the category on every selected photo at once — so 20 shots of the same
  // area are one pick, not twenty.
  async function applyBulkCategory() {
    if (!bulkCategory || selectedIds.size === 0) return;
    setBulkCategorizing(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.all(
      ids.map((photoId) => updateCategory(photoId, bulkCategory, true).catch(() => false))
    );
    setBulkCategorizing(false);
    const label = bulkCategory;
    const failedIds = ids.filter((_, i) => !results[i]);
    if (failedIds.length > 0) {
      // Keep the failed ones selected so a second click retries just those.
      setSelectedIds(new Set(failedIds));
      const ok = ids.length - failedIds.length;
      onMessage({ kind: "error", text: `Set ${ok} photo${ok !== 1 ? "s" : ""} to “${label}”; ${failedIds.length} failed (still selected — try again).`, ms: 8000 });
      return;
    }
    if (isAdmin) {
      setSelectedIds(new Set());
      setBulkCategory("");
    } else {
      clearSelection();
    }
    onMessage({ kind: "success", text: `Set ${ids.length} photo${ids.length !== 1 ? "s" : ""} to “${label}”.`, ms: 3000 });
  }

  // ── Cover photo ──────────────────────────────────────────────────────────
  // The featured image (spec sheet, showcase / listings card, flyer, social
  // posts). Clicking the current one clears it (falls back to the first photo).
  async function setHero(photoId: string) {
    const prev = state.heroPhotoId;
    const next = prev === photoId ? null : photoId;
    state.setHeroPhotoId(next); // optimistic
    const { error } = await supabase.from("listings").update({ hero_photo_id: next }).eq("id", listingId);
    if (error) {
      state.setHeroPhotoId(prev); // revert
      onMessage({ kind: "error", text: "Couldn't update the cover photo. Please try again.", ms: 3000 });
      return;
    }
    onMessage({ kind: "success", text: next ? "Cover photo set." : "Cover photo cleared.", ms: 2500 });
  }

  // ── Order ────────────────────────────────────────────────────────────────
  const [sorting, setSorting] = useState(false);

  // Drop: write display_order for every photo in the new order and mark the
  // listing hand-sorted — from here on the manual order wins and the
  // canonical walk-the-boat order steps aside.
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = photos.findIndex((p) => p.id === active.id);
    const newIndex = photos.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(photos, oldIndex, newIndex).map((p, i) => ({ ...p, display_order: i }));
    setPhotos(next);
    const { error: orderErr } = await reorderPhotos(supabase, listingId, next.map((p) => p.id));
    const { error: listErr } = await supabase.from("listings").update({ photo_order_manual: true }).eq("id", listingId);
    if (listErr || orderErr) {
      onMessage({ kind: "error", text: "Couldn’t save the new order — refresh and try again.", ms: 4000 });
    }
  }

  // Rewrite display_order into the standard walk-the-boat order: outside, up
  // top, cockpit, engine room, then in through the interior. Written down
  // rather than sorted at render time, so the portal, client sends and the
  // website all show the identical sequence — and you can still drag after.
  async function sortToStandardOrder() {
    if (sorting || photos.length === 0) return;
    const question = isAdmin
      ? "Re-sort all photos into the standard order? Your current order will be replaced."
      : "Re-sort all photos into the standard order? Your current order will be replaced. You can still drag afterwards.";
    if (!confirm(question)) return;
    setSorting(true);
    try {
      const sorted = orderPhotos(photos, { manual: false, heroId: state.heroPhotoId ?? null, byFilename: true });
      const { error: orderErr } = await reorderPhotos(supabase, listingId, sorted.map((p) => p.id));
      if (orderErr) {
        onMessage({ kind: "error", text: `Couldn't save the new order: ${orderErr}`, ms: 8000 });
        return;
      }
      setPhotos(sorted.map((p, i) => ({ ...p, display_order: i })));
      const { error: listErr } = await supabase.from("listings").update({ photo_order_manual: true }).eq("id", listingId);
      if (listErr) {
        onMessage({ kind: "error", text: `Photos re-sorted, but the listing couldn't be marked hand-sorted (${listErr.message}) — the order may revert. Try again.`, ms: 10000 });
        return;
      }
      onMessage({ kind: "success", text: "Sorted to standard order.", ms: 2500 });
    } finally {
      setSorting(false);
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  // All photo deletions go through /api/photos/delete: the server verifies
  // access, deletes the recorded path (and its stored copies) and writes the
  // deletion log. Photos only leave the screen once the server confirms.
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  async function deleteViaApi(body: Record<string, unknown>): Promise<string | null> {
    try {
      const res = await fetch("/api/photos/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return data.error ?? `Server returned ${res.status}`;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  async function deletePhoto(photoId: string, storagePath: string) {
    setDeletingIds((prev) => new Set(Array.from(prev).concat(photoId)));
    // Same body each page always sent (the route reads the path from the row).
    const err = await deleteViaApi(isAdmin ? { photoIds: [photoId] } : { photoId, storagePath });
    if (err) {
      onMessage({ kind: "error", text: `Couldn't delete that photo: ${err}`, ms: 6000 });
    } else {
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(photoId); return next; });
    }
    setDeletingIds((prev) => { const next = new Set(prev); next.delete(photoId); return next; });
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const toDelete = photos.filter((p) => selectedIds.has(p.id));
    const ids = new Set(toDelete.map((p) => p.id));
    // One call for the whole batch — one entry in the deletion log.
    const err = await deleteViaApi({ photoIds: toDelete.map((p) => p.id) });
    setDeleting(false);
    if (err) {
      onMessage({ kind: "error", text: `Couldn't delete the selected photos: ${err}. Nothing was removed.`, ms: 10000 });
      return;
    }
    setPhotos((prev) => prev.filter((p) => !ids.has(p.id)));
    setSelectedIds(new Set());
    setSelectMode(false);
    onMessage({ kind: "success", text: `${toDelete.length} photo${toDelete.length !== 1 ? "s" : ""} deleted.`, ms: 3000 });
  }

  async function deleteAll() {
    setDeleting(true);
    setConfirmDeleteAll(false);
    const ids = new Set(photos.map((p) => p.id));
    const err = await deleteViaApi({ photoIds: photos.map((p) => p.id) });
    setDeleting(false);
    if (err) {
      onMessage({ kind: "error", text: `Couldn't delete the photos: ${err}. Nothing was removed.`, ms: 10000 });
      return;
    }
    setPhotos((prev) => prev.filter((p) => !ids.has(p.id)));
    setSelectedIds(new Set());
    setSelectMode(false);
    onMessage({ kind: "success", text: "All photos deleted.", ms: 3000 });
  }

  // ── Replace ──────────────────────────────────────────────────────────────
  // Which tiles are mid-replace (and at what stage), and — broker page — which
  // just failed (the tile says so for a few seconds).
  const [replacing, setReplacing] = useState<Record<string, ReplaceStage>>({});
  const [replaceFailed, setReplaceFailed] = useState<Record<string, string>>({});
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);

  /** Open the file picker to replace one photo's file. */
  function startReplace(photoId: string) {
    if (replacing[photoId]) return;
    replaceTargetRef.current = photoId;
    if (replaceInputRef.current) {
      replaceInputRef.current.value = "";
      replaceInputRef.current.click();
    }
  }

  /** The replace file input's change handler. */
  function onReplaceFilePicked(file: File | undefined) {
    const target = replaceTargetRef.current;
    replaceTargetRef.current = null;
    if (file && target) void replacePhoto(target, file);
  }

  /**
   * Replace a photo's file, keeping its id — so its category, place in the
   * order, visibility and cover-photo status all stay. New file, new storage
   * path, then the server repoints the row and removes the old file; the tile
   * swaps to the new thumbnail (new path = no stale cached image).
   */
  async function replacePhoto(photoId: string, file: File) {
    const { data: { session } } = await supabase.auth.getSession();
    const folder = ownerFolder(session?.user?.id ?? null);
    if (!folder) return;
    setReplaceFailed((prev) => { const next = { ...prev }; delete next[photoId]; return next; });
    setReplacing((prev) => ({ ...prev, [photoId]: "uploading" }));
    if (isAdmin) onMessage({ kind: "success", text: "Replacing photo — uploading the new file…", ms: 0 });
    const r = await replaceListingPhoto({
      supabase,
      file,
      ownerFolder: folder,
      listingId,
      photoId,
      onStage: (stage) => {
        setReplacing((prev) => ({ ...prev, [photoId]: stage }));
        if (isAdmin && stage === "saving") onMessage({ kind: "success", text: "Replacing photo — swapping it in…", ms: 0 });
      },
    }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setReplacing((prev) => { const next = { ...prev }; delete next[photoId]; return next; });

    if (!r.ok) {
      if (!isAdmin) {
        setReplaceFailed((prev) => ({ ...prev, [photoId]: r.error }));
        setTimeout(() => setReplaceFailed((prev) => { const next = { ...prev }; delete next[photoId]; return next; }), 8000);
      }
      onMessage({ kind: "error", text: `Couldn't replace that photo: ${r.error}`, ms: 8000 });
      return;
    }
    const np = r.photo;
    // derivatives_at cleared server-side: the old stored copies belong to the old file.
    setPhotos((prev) => prev.map((p) => (p.id === photoId
      ? {
          ...p,
          storage_path: np.storage_path,
          filename: np.filename,
          derivatives_at: null,
          ...(caps.keepOriginalUrls ? { url: np.originalUrl ?? p.url ?? null } : {}),
        }
      : p)));
    setThumbs((prev) => {
      const next = { ...prev };
      if (np.thumbUrl) next[photoId] = np.thumbUrl; else delete next[photoId];
      return next;
    });
    setOriginals((prev) => {
      const next = { ...prev };
      if (np.originalUrl) next[photoId] = np.originalUrl; else delete next[photoId];
      return next;
    });
    setMissingIds((prev) => { const next = new Set(prev); next.delete(photoId); return next; });
    if (!np.thumbUrl) refreshThumbs();
    onMessage({
      kind: "success",
      text: isAdmin
        ? `Photo replaced with ${np.filename ?? "the new file"} — same spot, area and cover setting.`
        : "Photo replaced — same spot, category and cover setting.",
      ms: 4000,
    });
  }

  return {
    // select mode
    selectedIds, setSelectedIds, selectMode, setSelectMode, toggleSelect, selectAll, clearSelection,
    bulkCategory, setBulkCategory, bulkCategorizing, applyBulkCategory,
    // AI labels
    labeling, labelNote, labelWithAi,
    // upload
    fileInputRef, anyFileInputRef, uploading, uploadProgress, uploadFailed, setUploadFailed, retryFailedUploads,
    pendingFiles, setPendingFiles, pendingCategory, setPendingCategory, handleFiles, doUpload,
    // per-photo
    toggleVisibility, updateCategory, setHero,
    // order
    sorting, handleDragEnd, sortToStandardOrder,
    // delete
    deletingIds, deleting, deletePhoto, deleteSelected, deleteAll,
    confirmDeleteSelected, setConfirmDeleteSelected, confirmDeleteAll, setConfirmDeleteAll,
    // replace
    replacing, replaceFailed, replaceInputRef, startReplace, onReplaceFilePicked, replacePhoto,
  };
}

export type PhotoActions = ReturnType<typeof usePhotoActions>;
