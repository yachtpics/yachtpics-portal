"use client";

import { useEffect, useState } from "react";

/**
 * One-line boat-show nudge at the top of My Listings while a show is coming
 * up. Dismissible for this browser session only (sessionStorage, no DB).
 * `highlight` (from ?show=<key>, the announcement email's link) gives it an
 * accent ring and brings it back even if it was dismissed.
 */
export default function ShowBanner({
  showKey,
  showShort,
  marked,
  highlight,
}: {
  showKey: string;
  showShort: string;
  marked: number;
  highlight: boolean;
}) {
  const storageKey = `yp_show_banner_dismissed_${showKey}`;
  // Start hidden until we know whether it was dismissed, so it never flashes.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(storageKey) === "1"; } catch { /* storage blocked */ }
    setVisible(highlight || !dismissed);
  }, [storageKey, highlight]);

  if (!visible) return null;

  function dismiss() {
    try { sessionStorage.setItem(storageKey, "1"); } catch { /* storage blocked */ }
    setVisible(false);
  }

  return (
    <div
      role="status"
      className={`mb-6 flex items-center justify-between gap-3 px-4 py-3 rounded-lg text-sm border ${
        highlight ? "bg-accent-50 border-accent-400 ring-1 ring-accent-400" : "bg-white border-hairline"
      }`}
    >
      <p className="text-ink-700">
        <span className="font-medium text-ink-900">Showing at {showShort}?</span>{" "}
        Mark your boats so your dock cards are ready.{" "}
        <span className="text-ink-500 tabular-nums">{marked} marked.</span>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 text-ink-400 hover:text-ink-700 text-lg leading-none px-1 transition-colors duration-fast"
      >
        &times;
      </button>
    </div>
  );
}
