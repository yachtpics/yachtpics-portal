"use client";

import { useEffect } from "react";

/**
 * A single confirmation dialog for anything destructive.
 *
 * Deleting media in this portal is genuinely permanent — the file leaves
 * storage and there is no recycle bin — but several delete buttons acted on the
 * first click with nothing in between. Videos were the worst case: large,
 * irreplaceable, and often the only copy the broker has.
 *
 * Every one of these should name what's being deleted and say plainly that it
 * can't be undone. Vague confirmations ("Are you sure?") train people to click
 * through without reading.
 */
export default function ConfirmDeleteDialog({
  open,
  title,
  body,
  confirmLabel = "Delete",
  busy = false,
  busyLabel = "Deleting…",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Escape cancels — the safe direction. Deliberately no Enter-to-confirm:
  // a destructive action shouldn't be reachable by a stray keypress.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-ink-950/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // Clicking the backdrop cancels, but never while a delete is in flight.
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        className="bg-white rounded-card p-6 max-w-sm w-full shadow-elev-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-h2 text-ink-900 mb-2">{title}</h3>
        <div className="text-ink-500 text-sm mb-6">{body}</div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 bg-white border border-hairline-strong hover:bg-ink-50 disabled:opacity-50 text-ink-700 text-sm font-medium py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 bg-danger-600 hover:bg-danger-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
