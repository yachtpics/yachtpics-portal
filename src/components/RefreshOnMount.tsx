"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Forces a fresh server render when you land on a page.
 *
 * Next's client-side Router Cache will happily re-show a snapshot of a page
 * taken before you changed anything — so a gallery you just created is missing
 * from the list, or photos you just uploaded are missing inside it, until you
 * hard-refresh. `experimental.staleTimes` is supposed to prevent that but
 * doesn't reliably, so we ask for the refresh explicitly.
 *
 * Also refreshes when the tab regains focus, which covers uploading in one tab
 * and viewing in another.
 *
 * Drop into any admin/data page that must never show stale data.
 */
export default function RefreshOnMount() {
  const router = useRouter();
  const ranRef = useRef(false);

  useEffect(() => {
    // Guard the initial run so the refresh (which re-renders server components
    // but preserves this client component) can't loop.
    if (!ranRef.current) {
      ranRef.current = true;
      router.refresh();
    }

    function onFocus() {
      if (document.visibilityState === "visible") router.refresh();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [router]);

  return null;
}
