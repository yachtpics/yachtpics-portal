"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Next's client-side router cache can serve a stale snapshot of a page when you
// navigate to it (even when the page is force-dynamic on the server). Dropping
// this on a page forces a one-time re-fetch on arrival, so the list always
// reflects the current data without a manual browser refresh.
export default function RefreshOnMount() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
