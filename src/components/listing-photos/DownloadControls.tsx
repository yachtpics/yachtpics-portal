"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SHARE_BATCH } from "@/lib/photoSave";
import { DOWNLOAD_SIZES, type DownloadSize, type OriginalSave } from "./useDownloads";

/** Broker page: the size menu next to Download All / Download N. */
export function DownloadSizeSelect({ value, onChange, disabled }: {
  value: DownloadSize;
  onChange: (v: DownloadSize) => void;
  disabled: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as DownloadSize)}
      disabled={disabled}
      title="Size for every photo download on this page"
      aria-label="Download size"
      className="text-sm border border-hairline-strong rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent-500 bg-white text-ink-700 disabled:opacity-50"
    >
      {DOWNLOAD_SIZES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/**
 * Admin page: the Save / share panel — pinned to the bottom of the screen so
 * it's in reach wherever the page is scrolled, and above the lightbox.
 */
export function SavePanel({ save }: { save: OriginalSave }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const { saveBusy, shareJob, saveError } = save;
  if (!mounted || !(saveBusy || shareJob || saveError)) return null;
  return createPortal(
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 10000, padding: "12px 16px calc(12px + env(safe-area-inset-bottom))" }}>
      <div className="mx-auto max-w-md bg-white border border-hairline rounded-card shadow-elev-2 p-4">
        {saveBusy ? (
          <p className="text-sm text-ink-700">
            {saveBusy.zipping
              ? "Making the zip…"
              : `Getting full-size photos… ${saveBusy.done} of ${saveBusy.total}`}
          </p>
        ) : shareJob ? (
          <>
            <p className="text-sm text-ink-900 font-medium">
              {shareJob.targets.length > SHARE_BATCH
                ? `Photos ${shareJob.start + 1}–${Math.min(shareJob.start + SHARE_BATCH, shareJob.targets.length)} of ${shareJob.targets.length} ready`
                : `${shareJob.files.length} photo${shareJob.files.length !== 1 ? "s" : ""} ready`}
            </p>
            <p className="text-xs text-ink-500 mt-1">
              Tap below, then choose Save image / Save to Photos, or share straight to Instagram or Facebook.
              {shareJob.targets.length > SHARE_BATCH ? ` Your phone takes ${SHARE_BATCH} at a time; the next ${SHARE_BATCH} get ready after each.` : ""}
              {shareJob.failed > 0 ? ` ${shareJob.failed} couldn't be fetched and are left out.` : ""}
            </p>
            {saveError && <p className="text-xs text-danger-600 mt-2">{saveError}</p>}
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={save.shareReadyBatch}
                className="flex-1 bg-ink-950 hover:bg-ink-800 text-white text-sm font-semibold px-4 py-2.5 rounded-ctl"
              >
                {`Save / share ${shareJob.files.length} photo${shareJob.files.length !== 1 ? "s" : ""}`}
              </button>
              <button
                onClick={save.downloadReadyBatchInstead}
                className="text-sm text-ink-600 border border-hairline-strong px-3 py-2.5 rounded-ctl"
              >
                Download instead
              </button>
              <button onClick={save.closeSavePanel} className="text-sm text-ink-400 px-2 py-2.5">Cancel</button>
            </div>
          </>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-danger-600">{saveError}</p>
            <button onClick={save.closeSavePanel} className="text-sm text-ink-500 shrink-0">Close</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
