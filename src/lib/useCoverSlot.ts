"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Browser side of the office cover slots (src/lib/officeCoverSlots.ts).
 *
 * The listing page (and the social post page) get `listingAccess` from
 * /api/subscription/status?listingId=… . When the boat is AVAILABLE for this
 * viewer (a paying company admin's plan has room), the page's paid tools look
 * unlocked; `ensure()` must run right before the first paid action whose work
 * happens in the browser. It asks POST /api/listings/[id]/cover-slot once,
 * and the action goes ahead only on true. For every other boat it answers
 * true at once without a request (own plan, Office plan, Reel Service, a boat
 * already covered, comped and demo accounts — nothing changes for them).
 */
export type ListingSlotInfo = {
  reason: string;
  canTakeSlot: boolean;
  notice: { tone: "subtle" | "full" | "locked" | string; text: string; upgrade: boolean } | null;
  adminName: string | null;
  officeName: string | null;
  /** Soft mode (the default): the call only COUNTS the boat — fire and continue, never block. */
  soft?: boolean;
};

export function useCoverSlot(listingId: string, opts: { onLocked?: () => void } = {}) {
  const [info, setInfoState] = useState<ListingSlotInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const infoRef = useRef<ListingSlotInfo | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);
  const onLockedRef = useRef(opts.onLocked);
  onLockedRef.current = opts.onLocked;

  const setInfo = useCallback((next: ListingSlotInfo | null) => {
    infoRef.current = next;
    setInfoState(next);
  }, []);

  /** True when the paid action may go ahead. Shows a message (kept until ×) when not. */
  const ensure = useCallback(async (): Promise<boolean> => {
    const cur = infoRef.current;
    if (!cur || !cur.canTakeSlot || cur.reason !== "officeAdminAvailable") return true;
    if (cur.soft) {
      // Counter only: record the boat in the background; the action goes
      // ahead at once whatever the answer (a failure is silent).
      setInfo({ ...cur, reason: "officeAdminSlot", canTakeSlot: false });
      void fetch(`/api/listings/${listingId}/cover-slot`, { method: "POST", cache: "no-store", keepalive: true }).catch(() => undefined);
      return true;
    }
    if (pending.current) return pending.current;
    pending.current = (async () => {
      try {
        const res = await fetch(`/api/listings/${listingId}/cover-slot`, { method: "POST", cache: "no-store" });
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (res.ok && d.ok) {
          setInfo({ ...cur, reason: "officeAdminSlot", canTakeSlot: false, notice: null });
          return true;
        }
        setError(d.error || "The plan couldn't be checked just now. Try again in a moment.");
        if (res.status === 403) {
          // The slots filled up meanwhile: the boat is locked for this viewer now.
          setInfo({ ...cur, reason: "officeAdminFull", canTakeSlot: false, notice: null });
          onLockedRef.current?.();
        }
        return false;
      } catch {
        setError("We couldn't reach the server. Check your connection and try again.");
        return false;
      } finally {
        pending.current = null;
      }
    })();
    return pending.current;
  }, [listingId, setInfo]);

  /** Run `action` only once the slot question is settled. */
  const withSlot = useCallback((action: () => void) => {
    void ensure().then((ok) => { if (ok) action(); });
  }, [ensure]);

  /** The boat looks unlocked only because a slot is free (nothing used yet). */
  // (Hard cap only — in soft mode nothing ever waits on the slot.)
  const pendingSlot = !!info && !info.soft && info.canTakeSlot && info.reason === "officeAdminAvailable";

  return { info, setInfo, error, dismissError: () => setError(null), ensure, withSlot, pendingSlot };
}
