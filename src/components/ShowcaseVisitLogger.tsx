"use client";

import { useEffect, useRef } from "react";

// Records a Recently Photographed page open for the signed-in broker/assistant.
// Fire-and-forget, once per mount; the server throttles to one per 30 minutes.
export default function ShowcaseVisitLogger() {
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    fetch("/api/showcase/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "page_open" }),
    }).catch(() => {});
  }, []);
  return null;
}
