"use client";

/**
 * Nov 11 — bulk downloads on locked-down work computers (src/lib/zipDownload.ts,
 * "plain downloads"). Two small pieces the public download pages share
 * (/d, /g, client galleries); the listing page has its own in
 * src/components/listing-photos.
 *
 *  - PickerCancelledHint: the Save / folder window came back "cancelled". A
 *    managed PC that blocks it answers exactly like Cancel, so never end in
 *    silence — say nothing was saved and offer the plain zip (ordinary
 *    browser downloads, no window).
 *  - RestoreFolderLink: plain downloads are remembered in this browser but it
 *    can save to a folder — a quiet way back.
 */

export const PICKER_HINT_TEXT = "Nothing was saved. If you didn't cancel, your computer may be blocking that —";

export function PickerCancelledHint({ onPlain, className, buttonClassName }: {
  onPlain: () => void;
  className?: string;
  buttonClassName?: string;
}) {
  return (
    <p role="status" className={className ?? "mt-3 text-sm text-ink-600"}>
      {PICKER_HINT_TEXT}{" "}
      <button onClick={onPlain} className={buttonClassName ?? "font-semibold underline underline-offset-2 text-ink-900 hover:text-accent-700"}>
        Download as a zip instead
      </button>
    </p>
  );
}

export function RestoreFolderLink({ onRestore, className }: { onRestore: () => void; className?: string }) {
  return (
    <button
      onClick={onRestore}
      title="Download all will ask for a folder and save the photos straight into it"
      className={className ?? "text-xs text-ink-400 hover:text-ink-700 underline underline-offset-2 px-1"}
    >
      Save straight to a folder instead
    </button>
  );
}
