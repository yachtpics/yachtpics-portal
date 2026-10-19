"use client";

import { useRef, useState } from "react";
import {
  DndContext, closestCenter, MouseSensor, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import RetryImg from "@/components/RetryImg";
import OrientedThumbnail from "./OrientedThumbnail";
import type { ListingPhoto, PhotoVariant, ReplaceStage } from "./types";

export interface PhotoGridProps {
  variant: PhotoVariant;
  photos: ListingPhoto[];
  thumbs: Record<string, string>;
  /** broker: lightbox copies already signed — the tile's last-resort fallback. */
  originals?: Record<string, string>;
  /** broker: files /api/thumbs says are missing ("File missing" tile). */
  missingIds?: Set<string>;
  selectedIds: Set<string>;
  selectMode: boolean;
  heroPhotoId: string | null;
  customCategories: string[];
  /** broker: tiles hidden while their delete is in flight. */
  deletingIds?: Set<string>;
  replacing: Record<string, ReplaceStage>;
  /** broker: why the last replace failed, per tile. */
  replaceFailed?: Record<string, string>;
  /** A download / save is running — per-photo download buttons are disabled. */
  downloadBusy: boolean;
  /** broker: per-photo download tooltip (names the chosen size). */
  downloadTitle?: string;
  /** broker: show Replace (needs upload access). Admin always can. */
  canReplace?: boolean;
  onOpen: (index: number) => void;
  onToggleSelect: (photoId: string) => void;
  onSetHero: (photoId: string) => void;
  onDownload: (photo: ListingPhoto) => void;
  onToggleVisibility: (photo: ListingPhoto) => void;
  onUpdateCategory: (photoId: string, category: string) => void;
  /** broker: a typed-in category joins the saved list. */
  onSaveCategory?: (category: string) => void;
  onDelete: (photo: ListingPhoto) => void;
  onReplace: (photoId: string) => void;
  onDragEnd: (event: DragEndEvent) => void;
}

/**
 * The sortable photo grid. The two pages keep their own look:
 *  • broker — "the gallery wall": prints on paper, controls on demand
 *    (hover / focus; a row under the photo on phones), drag by the grip.
 *  • admin — compact cards with the category and Hide / Save / Replace /
 *    Delete under each thumbnail; the photo itself is the drag handle.
 * Wrap either in nothing else — it brings its own DndContext.
 */
export default function PhotoGrid(props: PhotoGridProps) {
  return props.variant === "broker" ? <BrokerPhotoGrid {...props} /> : <AdminPhotoGrid {...props} />;
}

function BrokerPhotoGrid({
  photos, thumbs, originals = {}, missingIds, selectedIds, selectMode, heroPhotoId, customCategories,
  deletingIds, replacing, replaceFailed = {}, downloadBusy, downloadTitle = "Download photo", canReplace = false,
  onOpen, onToggleSelect, onSetHero, onDownload, onToggleVisibility, onUpdateCategory, onSaveCategory,
  onDelete, onReplace, onDragEnd,
}: PhotoGridProps) {
  const tapStart = useRef<{ x: number; y: number } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
    <SortableContext items={photos.map(p => p.id)} strategy={rectSortingStrategy}>
    {/* The gallery wall — prints on paper, chrome on demand */}
    <div className="rounded-card bg-ink-50 border border-hairline p-2 sm:p-3">
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
    {photos.filter(p => !deletingIds?.has(p.id)).map((photo) => {
      const isSelected = selectedIds.has(photo.id);
      const index = photos.indexOf(photo);
      return (
        <BrokerPhotoCard
          key={photo.id}
          photo={photo}
          thumbUrl={thumbs[photo.id]}
          originalUrl={originals[photo.id]}
          fileMissing={!!missingIds?.has(photo.id)}
          index={index}
          isSelected={isSelected}
          selectMode={selectMode}
          downloading={downloadBusy}
          tapStart={tapStart}
          extraCategories={customCategories}
          isHero={heroPhotoId === photo.id}
          onSetHero={() => onSetHero(photo.id)}
          onTap={() => selectMode ? onToggleSelect(photo.id) : onOpen(index)}
          onDownload={() => onDownload(photo)}
          onToggleVisibility={() => onToggleVisibility(photo)}
          onUpdateCategory={(cat) => onUpdateCategory(photo.id, cat)}
          onSaveCategory={(cat) => onSaveCategory?.(cat)}
          onDelete={() => onDelete(photo)}
          canReplace={canReplace}
          replaceStage={replacing[photo.id] ?? null}
          replaceError={replaceFailed[photo.id] ?? null}
          onReplace={() => onReplace(photo.id)}
          downloadTitle={downloadTitle}
        />
      );
    })}
    </div>
    </div>
    </SortableContext>
    </DndContext>
  );
}

function AdminPhotoGrid({
  photos, thumbs, selectedIds, selectMode, heroPhotoId, customCategories, replacing, downloadBusy,
  onOpen, onToggleSelect, onSetHero, onDownload, onToggleVisibility, onUpdateCategory,
  onDelete, onReplace, onDragEnd,
}: PhotoGridProps) {
  // Drag-to-reorder: a mouse drag starts after 8px of movement, so a click is
  // still a click; on a phone a short press-and-hold picks the photo up, so an
  // ordinary swipe still scrolls. (Mouse + Touch rather than one Pointer
  // sensor, so a scroll on a phone can never turn into a drag.)
  const photoSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );
  // The click that ends a drag must not also open the lightbox.
  const lastDragAt = useRef(0);
  const [customEdit, setCustomEdit] = useState<{ photoId: string; value: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  return (
      <DndContext
        sensors={photoSensors}
        collisionDetection={closestCenter}
        onDragEnd={(e) => { lastDragAt.current = Date.now(); onDragEnd(e); }}
        onDragCancel={() => { lastDragAt.current = Date.now(); }}
      >
      <SortableContext items={photos.map((p) => p.id)} strategy={rectSortingStrategy}>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 items-start">
        {photos.map((photo, idx) => {
          const isSelected = selectedIds.has(photo.id);
          return (
            <SortableTile
              key={photo.id}
              id={photo.id}
              disabled={selectMode || customEdit?.photoId === photo.id}
              className={`rounded-lg overflow-hidden border-2 bg-white transition-colors duration-fast ease-quiet ${
                isSelected ? "border-accent-500 shadow-elev-2" :
                photo.is_visible ? "border-transparent" : "border-ink-200 opacity-60"
              }`}
            >
              {(dragHandle) => (<>
              {/* Thumbnail — click to enlarge or select; drag to reorder
                  (the photo itself is the handle, so the controls below
                  it never start a drag). */}
              <div
                {...dragHandle}
                className="relative cursor-pointer select-none touch-manipulation [-webkit-touch-callout:none]"
                title={selectMode ? undefined : "Click to enlarge \u00b7 drag to reorder"}
                onClick={() => {
                  if (Date.now() - lastDragAt.current < 300) return;
                  if (selectMode) onToggleSelect(photo.id);
                  else onOpen(idx);
                }}
              >
                {/* Only ever the resized url — never the original. Falling back
                    to photo.url would make the browser pull every full-size
                    file (~2 MB each) on first paint. */}
                {photo.url ? (
                  <OrientedThumbnail url={thumbs[photo.id] ?? null} fallbackUrl={photo.url} filename={photo.filename} />
                ) : (
                  <div className="w-full aspect-[4/3] bg-ink-100 flex items-center justify-center text-ink-400 text-xs">No preview</div>
                )}
                {replacing[photo.id] && (
                  <div role="status" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80">
                    <span aria-hidden className="h-5 w-5 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
                    <span className="text-xs font-medium text-ink-800">
                      {replacing[photo.id] === "uploading" ? "Uploading…" : "Swapping in…"}
                    </span>
                  </div>
                )}
                {selectMode && (
                  <div className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center ${
                    isSelected ? "bg-accent-500 border-accent-500" : "bg-white/80 border-ink-300"
                  }`}>
                    {isSelected && <span className="text-ink-950 text-xs font-bold">✓</span>}
                  </div>
                )}
                {/* Cover-photo star — sets the featured image (showcase card,
                    listings card, flyer, social). Filled = current cover. */}
                {!selectMode && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onSetHero(photo.id); }}
                    title={heroPhotoId === photo.id ? "Cover photo — click to clear" : "Set as cover photo"}
                    aria-label={heroPhotoId === photo.id ? "Clear cover photo" : "Set as cover photo"}
                    className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-sm shadow-elev-1 transition-colors duration-fast ease-quiet ${
                      heroPhotoId === photo.id
                        ? "bg-accent-500 text-ink-950"
                        : "bg-white/85 text-ink-500 hover:text-ink-900"
                    }`}
                  >
                    {heroPhotoId === photo.id ? "★" : "☆"}
                  </button>
                )}
              </div>

              {/* Category + actions below thumbnail */}
              <div className="p-2 bg-white">
                {customEdit?.photoId === photo.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      autoFocus
                      value={customEdit.value}
                      onChange={(e) => setCustomEdit({ photoId: photo.id, value: e.target.value })}
                      onBlur={() => {
                        const v = customEdit.value.trim();
                        onUpdateCategory(photo.id, v || "Other");
                        setCustomEdit(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const v = customEdit.value.trim();
                          onUpdateCategory(photo.id, v || "Other");
                          setCustomEdit(null);
                        }
                        if (e.key === "Escape") setCustomEdit(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Type & press Enter..."
                      className="text-xs text-ink-700 bg-transparent border-b border-hairline-strong outline-none flex-1 min-w-0 focus:border-accent-500"
                    />
                    <button type="button" onClick={(e) => { e.stopPropagation(); setCustomEdit(null); }}
                      className="text-ink-400 hover:text-ink-600 text-xs px-1">✕</button>
                  </div>
                ) : (
                  <select
                    value={
                      (PHOTO_CATEGORIES as readonly string[]).includes(photo.category ?? "") ||
                      customCategories.includes(photo.category ?? "")
                        ? (photo.category ?? "Other")
                        : "__custom__"
                    }
                    onChange={(e) => {
                      e.stopPropagation();
                      if (e.target.value === "__new__") {
                        setCustomEdit({ photoId: photo.id, value: "" });
                      } else {
                        onUpdateCategory(photo.id, e.target.value);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-ink-600 bg-transparent border-none outline-none cursor-pointer hover:text-accent-700 transition-colors duration-fast ease-quiet max-w-full"
                  >
                    <option value="__new__">+ New custom...</option>
                    {[...PHOTO_CATEGORIES, ...customCategories]
                      .sort((a, b) => a.localeCompare(b))
                      .map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                {!photo.is_visible && <span className="text-[10px] text-ink-400 ml-1">· hidden</span>}
                {!selectMode && (
                  <div className="flex gap-1.5 mt-2">
                    <button
                      onClick={() => onToggleVisibility(photo)}
                      className="flex-1 text-[10px] font-medium text-ink-500 hover:text-ink-800 border border-hairline-strong hover:border-ink-400 rounded py-1 transition-colors duration-fast ease-quiet"
                    >
                      {photo.is_visible ? "Hide" : "Show"}
                    </button>
                    <button
                      onClick={() => onDownload(photo)}
                      disabled={downloadBusy}
                      title="Download the full-size photo"
                      aria-label="Download this photo"
                      className="flex-1 text-[10px] font-medium text-ink-700 hover:text-ink-900 border border-hairline-strong hover:border-accent-500 disabled:opacity-50 rounded py-1 transition-colors duration-fast ease-quiet"
                    >
                      ↓ Save
                    </button>
                    <button
                      onClick={() => onReplace(photo.id)}
                      disabled={!!replacing[photo.id]}
                      title="Replace with a new file — keeps its place, area and cover setting"
                      aria-label="Replace this photo"
                      className="flex-1 text-[10px] font-medium text-ink-700 hover:text-ink-900 border border-hairline-strong hover:border-accent-500 disabled:opacity-50 rounded py-1 transition-colors duration-fast ease-quiet"
                    >
                      {replacing[photo.id] ? "…" : "Replace"}
                    </button>
                    {confirmDeleteId === photo.id ? (
                      <>
                        <button onClick={() => setConfirmDeleteId(null)}
                          className="flex-1 text-[10px] font-medium text-ink-500 border border-hairline-strong rounded py-1 transition-colors duration-fast ease-quiet">
                          Cancel
                        </button>
                        <button onClick={() => { setConfirmDeleteId(null); onDelete(photo); }}
                          className="flex-1 text-[10px] font-bold text-white bg-danger-600 hover:bg-danger-500 rounded py-1 transition-colors duration-fast ease-quiet">
                          Confirm
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(photo.id)}
                        className="flex-1 text-[10px] font-medium text-danger-600 hover:text-danger-700 border border-danger-200 hover:border-danger-300 rounded py-1 transition-colors duration-fast ease-quiet">
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
              </>)}
            </SortableTile>
          );
        })}
      </div>
      </SortableContext>
      </DndContext>
  );
}

/**
 * One sortable photo card. The card moves; only the element that receives
 * `dragHandle` (the thumbnail) starts a drag.
 */
function SortableTile({ id, disabled, className, children }: {
  id: string;
  disabled: boolean;
  className: string;
  children: (dragHandle: Record<string, unknown>) => React.ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: "relative",
    ...(isDragging ? { opacity: 0.6, zIndex: 10 } : {}),
  };
  return (
    <div ref={setNodeRef} style={style} className={className}>
      {children((listeners ?? {}) as Record<string, unknown>)}
    </div>
  );
}

// ─── Sortable photo card ───────────────────────────────────────────────────────
function BrokerPhotoCard({
  photo, thumbUrl, originalUrl, fileMissing, index, isSelected, selectMode, downloading, tapStart, extraCategories, isHero,
  onSetHero, onTap, onDownload, onToggleVisibility, onUpdateCategory, onSaveCategory, onDelete,
  canReplace, replaceStage, replaceError, onReplace, downloadTitle,
}: {
  photo: { id: string; filename: string | null; category: string | null; is_visible: boolean };
  /** Light resized version for the grid. */
  thumbUrl?: string;
  /** Full-size original, if one has already been signed (lightbox). Used only
   *  as the last-resort fallback when the thumbnail won't load. */
  originalUrl?: string;
  /** The file isn't in storage (from /api/thumbs). */
  fileMissing: boolean;
  index: number;
  isSelected: boolean;
  selectMode: boolean;
  downloading: boolean;
  tapStart: React.MutableRefObject<{ x: number; y: number } | null>;
  extraCategories: string[];
  isHero: boolean;
  onSetHero: () => void;
  onTap: () => void;
  onDownload: () => void;
  onToggleVisibility: () => void;
  onUpdateCategory: (cat: string) => void;
  onSaveCategory: (cat: string) => void;
  onDelete: () => void;
  /** Show the Replace button (needs upload access). */
  canReplace: boolean;
  /** Mid-replace stage for this tile, if any. */
  replaceStage: "uploading" | "saving" | null;
  /** Why the last replace failed (shown on the tile for a few seconds). */
  replaceError: string | null;
  onReplace: () => void;
  /** Tooltip for the download button — names the chosen size. */
  downloadTitle: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: photo.id });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isVertical, setIsVertical] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const allCategories = [...(PHOTO_CATEGORIES as readonly string[]), ...extraCategories.filter(c => !(PHOTO_CATEGORIES as readonly string[]).includes(c))];
  const inStandardList = allCategories.includes(photo.category ?? "");
  const [showCustomInput, setShowCustomInput] = useState(!inStandardList);
  const [customValue, setCustomValue] = useState(!inStandardList ? (photo.category ?? "") : "");

  function commitCustom() {
    const trimmed = customValue.trim();
    if (trimmed) {
      onUpdateCategory(trimmed);
      onSaveCategory(trimmed); // auto-save to master list
    } else {
      setShowCustomInput(false);
      setCustomValue("");
      onUpdateCategory("Other");
    }
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  // Chrome on demand: management affordances rest hidden and appear on hover or
  // keyboard focus. Devices that can't hover (touch) keep them visible so
  // nothing is lost dockside.
  const chrome =
    "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto " +
    "group-focus-within:opacity-100 group-focus-within:pointer-events-auto " +
    "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto " +
    "transition-opacity duration-base ease-quiet";

  const ctl =
    "flex h-8 w-8 items-center justify-center rounded-full " +
    "bg-white border border-hairline text-ink-700 shadow-elev-1 " +
    "hover:bg-ink-50 hover:text-ink-950 transition-colors duration-base ease-quiet " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex flex-col touch-manipulation ${
        isSelected ? "ring-2 ring-accent-500 ring-offset-2 ring-offset-ink-50" : ""
      }`}
    >
      <div className="relative">
        {/* The photograph — a print on a white mat, lifted by its shadow, nothing over it at rest */}
        <div
          onClick={onTap}
          onTouchStart={(e) => { tapStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
          onTouchEnd={(e) => {
            if (!tapStart.current) return;
            const dx = Math.abs(e.changedTouches[0].clientX - tapStart.current.x);
            const dy = Math.abs(e.changedTouches[0].clientY - tapStart.current.y);
            tapStart.current = null;
            if (dx < 8 && dy < 8) { e.preventDefault(); onTap(); }
          }}
          className={`relative w-full overflow-hidden rounded-[2px] bg-white shadow-print cursor-pointer ${isVertical ? "aspect-[3/4]" : "aspect-[4/3]"}`}
        >
          {!fileMissing ? (
            <>
              {(!imgLoaded || !thumbUrl) && <div aria-hidden className="absolute inset-0 animate-pulse bg-ink-950/[0.05]" />}
              {/* Deliberately renders NOTHING until the resized url arrives.
                  Falling back to photo.url looks harmless but makes the browser
                  fetch every full-size original (~2 MB each) the instant the
                  page paints — which is the exact cost we're removing. A brief
                  skeleton is much cheaper than 227 originals.
                  The lightbox and downloads sign originals on demand. */}
              {thumbUrl && (
              <RetryImg
                src={thumbUrl}
                fallbackSrc={originalUrl}
                alt={photo.filename ?? ""}
                loading={index < 4 ? "eager" : "lazy"}
                decoding="async"
                ref={(el) => { if (el && el.complete && el.naturalWidth > 0) setImgLoaded(true); }}
                onLoad={(e) => {
                  const img = e.target as HTMLImageElement;
                  setIsVertical(img.naturalHeight > img.naturalWidth);
                  setImgLoaded(true);
                }}
                className={`absolute inset-0 h-full w-full object-contain pointer-events-none transition-opacity duration-base ease-quiet ${
                  !imgLoaded ? "opacity-0" : photo.is_visible ? "opacity-100" : "opacity-40"
                }`}
              />
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
              <span className="text-2xl">⚠️</span>
              <div className="text-center px-3">
                <p className="text-warn-700 text-xs font-semibold">File missing</p>
                <p className="text-warn-700 text-[10px] mt-0.5">{canReplace ? "Use Replace to upload it again" : "Delete and re-upload"}</p>
              </div>
            </div>
          )}
          {!photo.is_visible && (
            <span className="pointer-events-none absolute left-1.5 bottom-1.5 label-caps-inverse rounded-sm bg-ink-950/70 px-1.5 py-0.5">
              Hidden
            </span>
          )}
          {replaceStage && (
            <div role="status" className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/80">
              <span aria-hidden className="h-5 w-5 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
              <span className="text-xs font-medium text-ink-800">
                {replaceStage === "uploading" ? "Uploading new photo…" : "Swapping it in…"}
              </span>
            </div>
          )}
          {!replaceStage && replaceError && (
            <div role="alert" className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-danger-600/90 px-2 py-1 text-[11px] font-medium text-white">
              Replace failed — {replaceError}
            </div>
          )}
        </div>

        {/* Hero (cover) star — the current cover stays marked; the rest appear on demand */}
        {!selectMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onSetHero(); }}
            onPointerDown={(e) => e.stopPropagation()}
            title={isHero ? "Cover photo — used on the spec sheet & social posts. Tap to clear." : "Set as cover photo (spec sheet & social posts)"}
            aria-label={isHero ? "Clear cover photo" : "Set as cover photo"}
            className={`absolute top-1.5 left-1.5 z-10 flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full text-sm transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
              isHero ? "bg-accent-500 text-ink-950 shadow-elev-1" : `bg-white/70 sm:bg-white border border-hairline text-ink-700 shadow-elev-1 hover:bg-ink-50 hover:text-ink-950 ${chrome}`
            }`}
          >
            {isHero ? "★" : "☆"}
          </button>
        )}

        {/* Drag handle — top-right grip */}
        {!selectMode && (
          <div
            {...attributes}
            {...listeners}
            title="Drag to reorder"
            className={`absolute top-1.5 right-1.5 z-10 flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-white/70 sm:bg-white border border-hairline text-ink-700 shadow-elev-1 hover:bg-ink-50 hover:text-ink-950 cursor-grab active:cursor-grabbing touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${chrome}`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <circle cx="4" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/>
              <circle cx="4" cy="6" r="1.2"/><circle cx="8" cy="6" r="1.2"/>
              <circle cx="4" cy="9" r="1.2"/><circle cx="8" cy="9" r="1.2"/>
            </svg>
          </div>
        )}

        {/* Actions on demand — download, hide/show, delete-with-confirm (sm+; phones get the row under the photo) */}
        {!selectMode && (
          <div
            className={`absolute inset-x-0 bottom-0 z-10 hidden sm:flex items-center justify-end gap-1 px-1.5 pb-1.5 pt-8 bg-gradient-to-t from-white/90 to-transparent ${chrome}`}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {confirmDelete ? (
              <>
                <span className="mr-auto pl-1 text-xs font-medium text-ink-800">Delete photo?</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                  className="h-11 sm:h-8 px-3 rounded-full bg-white border border-hairline text-ink-700 text-xs font-medium shadow-elev-1 hover:bg-ink-50 hover:text-ink-950 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                >
                  Cancel
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="h-11 sm:h-8 px-3 rounded-full bg-danger-600 text-white text-xs font-semibold hover:bg-danger-500 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                >
                  Confirm
                </button>
              </>
            ) : (
              <>
                {canReplace && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onReplace(); }}
                    disabled={!!replaceStage}
                    title="Replace with a new file — keeps its place, category and cover setting"
                    aria-label="Replace photo"
                    className={`${ctl} disabled:opacity-40`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onDownload(); }}
                  disabled={downloading}
                  title={downloadTitle}
                  aria-label={downloadTitle}
                  className={`${ctl} disabled:opacity-40`}
                >
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
                  title={photo.is_visible ? "Hide from slideshow & downloads" : "Show in slideshow & downloads"}
                  aria-label={photo.is_visible ? "Hide photo" : "Show photo"}
                  className={ctl}
                >
                  {photo.is_visible ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  )}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                  title="Delete photo"
                  aria-label="Delete photo"
                  className={`${ctl} hover:text-danger-600`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                </button>
              </>
            )}
          </div>
        )}

        {/* Checkbox in select mode */}
        {selectMode && (
          <div
            onClick={onTap}
            className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-sm border-2 flex items-center justify-center transition-colors duration-fast cursor-pointer shadow-elev-1 ${
              isSelected ? "bg-accent-500 border-accent-500" : "bg-white/90 border-ink-400"
            }`}
          >
            {isSelected && <span className="text-ink-950 text-xs font-bold">✓</span>}
          </div>
        )}
      </div>

      {/* Phone actions — below sm the controls sit under the photo instead of over it,
          so the whole picture stays visible on a narrow (folded) screen. */}
      {!selectMode && (
        <div
          className="flex sm:hidden items-center justify-around gap-1 px-0.5 pt-1"
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {confirmDelete ? (
            <>
              <span className="mr-auto pl-1 text-xs font-medium text-ink-800">Delete?</span>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                className="h-8 px-2 rounded-full text-ink-600 text-xs font-medium hover:bg-ink-100 hover:text-ink-950 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                Cancel
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="h-8 px-2.5 rounded-full bg-danger-600 text-white text-xs font-semibold hover:bg-danger-500 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                Confirm
              </button>
            </>
          ) : (
            <>
              {canReplace && (
                <button
                  onClick={(e) => { e.stopPropagation(); onReplace(); }}
                  disabled={!!replaceStage}
                  title="Replace with a new file"
                  aria-label="Replace photo"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-100 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-40"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDownload(); }}
                disabled={downloading}
                title={downloadTitle}
                aria-label={downloadTitle}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-100 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-40`}
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
                title={photo.is_visible ? "Hide from slideshow & downloads" : "Show in slideshow & downloads"}
                aria-label={photo.is_visible ? "Hide photo" : "Show photo"}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-100 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                {photo.is_visible ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                )}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                title="Delete photo"
                aria-label="Delete photo"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-danger-600 active:bg-ink-100 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
              </button>
            </>
          )}
        </div>
      )}

      {/* Gallery plaque — number, category, state */}
      <div className="flex items-center gap-1.5 px-1.5 pt-1 pb-0.5" title={photo.filename ?? undefined}>
        <span className="text-[11px] font-semibold tracking-caps text-ink-500 shrink-0">{String(index + 1).padStart(2, "0")}</span>
        {!showCustomInput ? (
          <select
            value={photo.category ?? "Other"}
            onChange={(e) => {
              e.stopPropagation();
              if (e.target.value === "__custom__") {
                setShowCustomInput(true);
                setCustomValue("");
              } else {
                onUpdateCategory(e.target.value);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-medium text-ink-600 bg-transparent border-none outline-none cursor-pointer hover:text-ink-950 focus-visible:text-ink-950 transition-colors duration-fast flex-1 min-w-0 truncate py-1"
          >
            <option value="__custom__">+ Custom...</option>
            {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input
              type="text"
              value={customValue}
              onChange={(e) => { e.stopPropagation(); setCustomValue(e.target.value); }}
              onBlur={commitCustom}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitCustom(); } }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              placeholder="Type & press Enter..."
              autoFocus
              className="text-xs text-ink-900 placeholder-ink-400 bg-transparent border-b border-hairline-strong outline-none flex-1 min-w-0 py-1 focus:border-accent-500"
            />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowCustomInput(false); setCustomValue(""); onUpdateCategory("Other"); }}
              className="text-ink-400 hover:text-ink-700 text-xs shrink-0 px-1.5 py-1"
              title="Back to list"
            >✕</button>
          </div>
        )}
        {!photo.is_visible && <span className="text-ink-600 text-[11px] shrink-0">hidden</span>}
      </div>
    </div>
  );
}

