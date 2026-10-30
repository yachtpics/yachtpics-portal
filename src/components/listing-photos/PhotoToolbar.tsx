"use client";

import type { ReactNode } from "react";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import type { PhotoVariant } from "./types";
import type { PhotoActions } from "./usePhotoActions";

/**
 * Select / Download / Delete All, and in select mode: Select all, Cancel,
 * bulk category, Download N, Delete N. Renders a fragment so it drops into
 * whatever button row the page already has.
 */
export function PhotoToolbar({
  variant, actions, photoCount, customCategories, downloadAllCount, downloadBusy, busyLabel,
  onDownloadAll, onDownloadSelected, sizeSelect, onSaveOriginals, onSaveOriginalsSelected, saveOriginalsBusy,
}: {
  variant: PhotoVariant;
  actions: PhotoActions;
  photoCount: number;
  customCategories: string[];
  /** broker: how many Download All takes (visible photos). */
  downloadAllCount?: number;
  downloadBusy: boolean;
  /** broker: the download buttons' label while a download runs ("Zipping... 40%"). */
  busyLabel?: string | null;
  onDownloadAll: () => void;
  onDownloadSelected: () => void;
  /** The download size menu, shown beside each download button. */
  sizeSelect?: ReactNode;
  /** admin: "Save originals" (full-size originals to the drive / share sheet),
   *  a separate button beside the sized downloads. */
  onSaveOriginals?: () => void;
  onSaveOriginalsSelected?: () => void;
  saveOriginalsBusy?: boolean;
}) {
  const a = actions;
  const n = a.selectedIds.size;
  const broker = variant === "broker";

  const bulkOptions = (
    <>
      <option value="">Assign category…</option>
      {PHOTO_CATEGORIES.filter((c) => c !== "Other").map((cat) => (
        <option key={cat} value={cat}>{cat}</option>
      ))}
      {customCategories
        .filter((c) => !(PHOTO_CATEGORIES as readonly string[]).includes(c))
        .map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      <option value="Other">Other</option>
    </>
  );

  if (broker) {
    return (
      <>
        {photoCount > 0 && !a.selectMode && (
          <>
            <button
              onClick={() => { a.setSelectMode(true); }}
              className="bg-white border border-hairline-strong hover:border-accent-500 text-ink-700 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              Select
            </button>
            {sizeSelect}
            <button
              onClick={onDownloadAll}
              disabled={downloadBusy}
              className="bg-white border border-hairline-strong hover:border-accent-500 text-ink-700 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {downloadBusy && busyLabel ? busyLabel : `Download All (${downloadAllCount ?? photoCount})`}
            </button>
            <button
              onClick={() => a.setConfirmDeleteAll(true)}
              className="bg-white border border-hairline-strong hover:border-danger-300 text-danger-600 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              Delete All
            </button>
          </>
        )}

        {a.selectMode && (
          <>
            <button onClick={a.selectAll} className="text-sm text-accent-700 hover:text-accent-600 font-medium transition-colors px-2">
              Select all
            </button>
            <button onClick={a.clearSelection} className="text-sm text-ink-400 hover:text-ink-600 transition-colors px-2">
              Cancel
            </button>
            {n > 0 && (
              <>
                {/* Bulk category assign */}
                <div className="flex items-center gap-2">
                  <select
                    value={a.bulkCategory}
                    onChange={(e) => a.setBulkCategory(e.target.value)}
                    className="text-sm border border-hairline-strong rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-500 bg-white"
                  >
                    {bulkOptions}
                  </select>
                  {a.bulkCategory && (
                    <button
                      onClick={a.applyBulkCategory}
                      disabled={a.bulkCategorizing}
                      className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
                    >
                      {a.bulkCategorizing ? "Applying…" : `Apply to ${n}`}
                    </button>
                  )}
                </div>
                {sizeSelect}
                <button
                  onClick={onDownloadSelected}
                  disabled={downloadBusy}
                  className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                >
                  {downloadBusy && busyLabel ? busyLabel : `Download ${n}`}
                </button>
                <button
                  onClick={() => a.setConfirmDeleteSelected(true)}
                  disabled={a.deleting}
                  className="bg-danger-600 hover:bg-danger-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                >
                  {a.deleting ? "Deleting..." : `Delete ${n}`}
                </button>
              </>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <>
      {photoCount > 0 && !a.selectMode && (
        <>
          <button
            onClick={() => a.setSelectMode(true)}
            className="bg-white border border-hairline-strong hover:border-accent-500 text-ink-700 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            Select
          </button>
          {sizeSelect}
          <button
            onClick={onDownloadAll}
            disabled={downloadBusy}
            className="bg-white border border-hairline-strong hover:border-accent-500 text-ink-700 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {downloadBusy && busyLabel ? busyLabel : `Download All (${downloadAllCount ?? photoCount})`}
          </button>
          {onSaveOriginals && (
            <button
              onClick={onSaveOriginals}
              disabled={saveOriginalsBusy}
              title="Full-size originals for your own copy (not logged). On a phone they open in the share sheet (10 at a time) — Save image, Instagram, Facebook."
              className="bg-white border border-hairline-strong hover:border-accent-500 text-ink-700 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              Save originals
            </button>
          )}
          <button
            onClick={() => a.setConfirmDeleteAll(true)}
            className="bg-white border border-hairline-strong hover:border-danger-300 text-danger-600 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            Delete All
          </button>
        </>
      )}
      {a.selectMode && (
        <>
          <button
            onClick={a.selectAll}
            className="text-sm text-accent-700 font-medium transition-colors duration-fast ease-quiet px-2"
          >
            Select all
          </button>
          <button
            onClick={a.clearSelection}
            className="text-sm text-ink-400 hover:text-ink-600 transition-colors duration-fast ease-quiet px-2"
          >
            Cancel
          </button>
          {n > 0 && (
            <>
              {/* Bulk category — set the area on every selected photo at once */}
              <div className="flex items-center gap-2">
                <select
                  value={a.bulkCategory}
                  onChange={(e) => a.setBulkCategory(e.target.value)}
                  className="text-sm border border-hairline-strong rounded-ctl px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
                >
                  {bulkOptions}
                </select>
                {a.bulkCategory && (
                  <button
                    onClick={a.applyBulkCategory}
                    disabled={a.bulkCategorizing}
                    className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet whitespace-nowrap"
                  >
                    {a.bulkCategorizing ? "Applying…" : `Apply to ${n}`}
                  </button>
                )}
              </div>
              {sizeSelect}
              <button
                onClick={onDownloadSelected}
                disabled={downloadBusy}
                className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors whitespace-nowrap"
              >
                {downloadBusy && busyLabel ? busyLabel : `Download ${n}`}
              </button>
              {onSaveOriginalsSelected && (
                <button
                  onClick={onSaveOriginalsSelected}
                  disabled={saveOriginalsBusy}
                  title="Full-size originals of the selected photos for your own copy (not logged)."
                  className="bg-white border border-hairline-strong hover:border-accent-500 text-ink-700 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  Save originals
                </button>
              )}
              <button
                onClick={() => a.setConfirmDeleteSelected(true)}
                disabled={a.deleting}
                className="bg-danger-600 hover:bg-danger-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet"
              >
                {a.deleting ? "Deleting..." : `🗑 Delete ${n}`}
              </button>
            </>
          )}
        </>
      )}
    </>
  );
}

/** "Delete N photos?" and "Delete all photos?" confirmations. */
export function DeletePhotosDialogs({ variant, actions, photoCount }: {
  variant: PhotoVariant;
  actions: PhotoActions;
  photoCount: number;
}) {
  const a = actions;
  const n = a.selectedIds.size;
  const broker = variant === "broker";
  return (
    <>
      <ConfirmDeleteDialog
        open={a.confirmDeleteSelected}
        title={`Delete ${n} photo${n !== 1 ? "s" : ""}?`}
        body="These photos will be permanently removed from this listing. This can't be undone."
        confirmLabel={`Delete ${n}`}
        busy={a.deleting}
        onCancel={() => a.setConfirmDeleteSelected(false)}
        onConfirm={() => { a.setConfirmDeleteSelected(false); a.deleteSelected(); }}
      />

      {/* Delete All confirmation */}
      {a.confirmDeleteAll && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className={broker ? "bg-white rounded-xl p-6 max-w-sm w-full shadow-xl" : "bg-white rounded-surface p-6 max-w-sm w-full shadow-elev-3"}>
            <h3 className="text-lg font-bold text-ink-900 mb-2">Delete all photos?</h3>
            <p className="text-ink-500 text-sm mb-6">
              This will permanently delete all {photoCount} photo{photoCount !== 1 ? "s" : ""}{broker ? "" : " for this listing"}. This can&apos;t be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => a.setConfirmDeleteAll(false)}
                className={`flex-1 bg-white border border-hairline-strong hover:bg-ink-50 text-ink-700 text-sm font-medium py-2.5 ${broker ? "rounded-lg transition-colors" : "rounded-ctl transition-colors duration-fast ease-quiet"}`}
              >
                Cancel
              </button>
              <button
                onClick={a.deleteAll}
                disabled={a.deleting}
                className={`flex-1 bg-danger-600 hover:bg-danger-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 ${broker ? "rounded-lg transition-colors" : "rounded-ctl transition-colors duration-fast ease-quiet"}`}
              >
                {a.deleting ? "Deleting..." : "Delete All"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
