"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * One-line "over your plan's listing range" nudge on My Listings
 * (src/lib/listingAllowance.ts). Dismiss hides it for this browser session
 * only (sessionStorage), like the boat-show banner; it comes back next
 * session while the broker is still over. Brokers get a link to Billing;
 * assistants are told to ask the broker (no billing action).
 */
export default function PlanNudgeBanner({
  brokerId,
  message,
  suggestedName,
  assistantFor,
}: {
  brokerId: string;
  message: string;
  suggestedName: string;
  /** The broker's first name when the viewer is their assistant. */
  assistantFor?: string | null;
}) {
  const storageKey = `yp_plan_nudge_dismissed_${brokerId}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(storageKey) === "1"; } catch { /* storage blocked */ }
    setVisible(!dismissed);
  }, [storageKey]);

  if (!visible) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(storageKey, "1"); } catch { /* storage blocked */ }
    setVisible(false);
  };

  return (
    <div role="status" className="mb-6 flex items-center justify-between gap-3 px-4 py-3 rounded-lg text-sm border bg-white border-hairline">
      <p className="text-ink-700">
        {message}{" "}
        {assistantFor ? (
          <span className="font-medium text-ink-900">Ask {assistantFor} to upgrade.</span>
        ) : (
          <Link href="/dashboard/billing" className="font-medium text-accent-700 hover:text-accent-800 underline underline-offset-2">
            Upgrade to {suggestedName}
          </Link>
        )}
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
