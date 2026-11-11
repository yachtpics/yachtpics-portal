"use client";

import { DownloadDialog, PICKER_HINT, PICKER_REPEAT, ZIP_INSTEAD_LABEL } from "@/components/listing-photos/DownloadNotice";

/**
 * Nov 11 — bulk downloads on locked-down work computers (src/lib/zipDownload.ts,
 * "plain downloads"). Two small pieces the public download pages share
 * (/d, /g, client galleries); the listing page has its own in
 * src/components/listing-photos.
 *
 *  - PickerCancelledHint: the Save / folder window came back "cancelled". A
 *    managed PC that blocks it answers exactly like Cancel, so never end in
 *    silence — a box says nothing was saved and offers the plain zip
 *    (ordinary browser downloads, no window).
 *  - RestoreFolderLink: plain downloads are remembered in this browser but it
 *    can save to a folder — a quiet way back.
 */

/**
 * Nov 11 (later): a box that must be answered, not a line under the buttons —
 * the assistant on a managed PC never noticed the line. Same dialog as the
 * listing pages (src/components/listing-photos/DownloadNotice.tsx); these
 * pages have no dialog of their own. `repeat`: the second cancel in a row in
 * this tab (src/lib/zipDownload.ts) — said more firmly.
 */
export function PickerCancelledHint({ onPlain, onDismiss, repeat = false }: {
  onPlain: () => void;
  onDismiss: () => void;
  repeat?: boolean;
}) {
  const copy = repeat ? PICKER_REPEAT : PICKER_HINT;
  return (
    <DownloadDialog
      title={copy.title}
      body={copy.body}
      primaryLabel={ZIP_INSTEAD_LABEL}
      onPrimary={onPlain}
      secondaryLabel="Not now"
      onClose={onDismiss}
    />
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
