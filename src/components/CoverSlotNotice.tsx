"use client";

import Link from "next/link";
import { BILLING_PATH } from "@/lib/planValue";
import type { ListingSlotInfo } from "@/lib/useCoverSlot";

/**
 * The office cover slots line on a listing (src/lib/officeCoverSlots.ts).
 * Soft mode (default): only the paying admin gets a line — "3 of 5 boats in
 * use on your Starter plan." or, over the range, "You're using the Portal's
 * tools on 7 boats. Your Starter plan covers 5. Growth covers 6–10 boats."
 * with a Billing link. Nobody else sees anything. Hard cap only:
 *   subtle — company admin, boat AVAILABLE: "Your Starter plan covers 5 boats. 3 are in use. Using a tool on this boat will use one."
 *   full   — company admin, FULL: "…and all 5 are in use: …. Growth covers 6–10 boats." + Billing link
 *   locked — anyone else on a boat without a slot: "Kelly Sprigg's plan covers 5 boats at SYC Yachts and this isn't one of them yet. …"
 * Plus any refusal from the cover-slot route, which stays until × (owner's rule).
 */
export default function CoverSlotNotice({ info, error, onDismissError, className = "mb-5" }: {
  info: ListingSlotInfo | null;
  error: string | null;
  onDismissError: () => void;
  className?: string;
}) {
  const notice = info?.notice ?? null;
  if (!notice && !error) return null;
  return (
    <div className={className}>
      {error && (
        <div role="alert" className="mb-2 px-4 py-3 rounded-lg text-sm bg-danger-50 border border-danger-200 text-danger-700 flex items-start gap-3">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={onDismissError} aria-label="Dismiss" className="text-danger-700 hover:text-danger-900 leading-none text-lg">×</button>
        </div>
      )}
      {notice && !error && (
        notice.tone === "subtle" ? (
          <p className="text-xs text-ink-500">
            {notice.text}
            {notice.upgrade && (
              <>
                {" "}
                <Link href={BILLING_PATH} className="font-medium underline underline-offset-2 hover:text-ink-700">Billing →</Link>
              </>
            )}
          </p>
        ) : (
          <div className={`px-4 py-3 rounded-lg text-sm border ${notice.tone === "full" ? "bg-warn-50 border-warn-200 text-warn-800" : "bg-ink-50 border-hairline-strong text-ink-700"}`}>
            {notice.text}
            {notice.upgrade && (
              <>
                {" "}
                <Link href={BILLING_PATH} className="font-semibold underline underline-offset-2">Billing →</Link>
              </>
            )}
          </div>
        )
      )}
    </div>
  );
}
