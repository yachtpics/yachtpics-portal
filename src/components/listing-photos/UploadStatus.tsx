"use client";

import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import { guessCategory } from "@/lib/guessCategory";
import type { PhotoVariant } from "./types";
import type { PhotoActions } from "./usePhotoActions";

/**
 * The two hidden file inputs: "+ Add Photos" (several) and Replace (one).
 * Render once anywhere on the page; buttons click them through
 * `actions.fileInputRef` / `actions.startReplace`.
 */
export function PhotoFileInputs({ actions }: { actions: PhotoActions }) {
  return (
    <>
      {/* ".zip" is deliberate: Android only offers the Files picker (Downloads,
          folders, zips) when the accepted types aren't all images — with
          "image/*" alone it shows the Gallery picker, which can't see a folder
          extracted from a download. A zip is unpacked in the browser. */}
      <input ref={actions.fileInputRef} type="file" accept="image/*,.zip,application/zip" multiple className="hidden" onChange={(e) => actions.handleFiles(e.target.files)} />
      <input
        ref={actions.replaceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => actions.onReplaceFilePicked(e.target.files?.[0])}
      />
    </>
  );
}

/** Progress bar while a batch uploads. */
export function UploadProgress({ variant, actions }: { variant: PhotoVariant; actions: PhotoActions }) {
  if (!actions.uploading) return null;
  const broker = variant === "broker";
  return (
    <div className={broker ? "mb-5" : "mb-4"}>
      <div className="flex justify-between text-xs text-ink-500 mb-1">
        <span>Uploading...</span><span className={broker ? undefined : "tabular-nums"}>{actions.uploadProgress}%</span>
      </div>
      <div className="bg-ink-100 rounded-full h-2">
        <div className="bg-accent-500 h-2 rounded-full transition-all" style={{ width: `${actions.uploadProgress}%` }} />
      </div>
    </div>
  );
}

/** "8 uploaded, 2 failed: a.jpg, b.jpg" with Retry for just those. */
export function UploadFailedNotice({ variant, actions }: { variant: PhotoVariant; actions: PhotoActions }) {
  const failed = actions.uploadFailed;
  if (!failed || actions.uploading) return null;
  const broker = variant === "broker";
  return (
    <div role="alert" className={`${broker ? "mb-5 rounded-lg" : "mb-4 rounded-ctl"} px-4 py-3 text-sm bg-danger-50 border border-danger-200 text-danger-700 flex items-start justify-between gap-3`}>
      <span>
        {failed.ok} uploaded, {failed.files.length} failed: {failed.files.map((f) => f.name).join(", ")}
      </span>
      <span className="shrink-0 flex items-center gap-3">
        <button
          onClick={actions.retryFailedUploads}
          className="font-semibold underline underline-offset-2 hover:text-danger-600"
        >
          Retry
        </button>
        <button
          onClick={() => actions.setUploadFailed(null)}
          className="text-danger-600 hover:text-danger-700 leading-none text-base font-bold"
          aria-label="Dismiss"
        >
          ×
        </button>
      </span>
    </div>
  );
}

/** Broker page: pick a category for photos the filename can't place
 *  (only asked when AI labelling is off). */
export function UncategorizedPrompt({ actions }: { actions: PhotoActions }) {
  const pendingFiles = actions.pendingFiles;
  if (!pendingFiles) return null;
  return (
    <div className="mb-5 bg-warn-50 border border-warn-200 rounded-xl px-5 py-4">
      <p className="text-sm font-semibold text-warn-800 mb-1">
        {pendingFiles.filter(f => guessCategory(f.name) === "Other").length} of {pendingFiles.length} photo{pendingFiles.length !== 1 ? "s" : ""} couldn&apos;t be auto-categorized
      </p>
      <p className="text-xs text-warn-700 mb-3">
        Pick a category to apply to those photos, or skip and assign them manually after uploading.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={actions.pendingCategory}
          onChange={(e) => actions.setPendingCategory(e.target.value)}
          className="text-sm border border-warn-200 bg-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-500"
        >
          {PHOTO_CATEGORIES.filter(c => c !== "Other").map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
          <option value="Other">Other (assign later)</option>
        </select>
        <button
          onClick={() => actions.doUpload(pendingFiles, actions.pendingCategory === "Other" ? null : actions.pendingCategory)}
          className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          Upload {pendingFiles.length} photo{pendingFiles.length !== 1 ? "s" : ""}
        </button>
        <button
          onClick={() => actions.setPendingFiles(null)}
          className="text-sm text-ink-400 hover:text-ink-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
