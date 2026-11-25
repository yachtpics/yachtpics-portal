"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin broker page, for a paying company admin (office cover slots —
 * src/lib/officeCoverSlots.ts): the office boats holding her plan's slots,
 * each with Release. Releasing locks that boat again for its owner until the
 * company admin uses a tool on it (or another boat) — no billing change.
 */
export default function CoverSlotsPanel({ planName, limit, used, ownCount, slots, waiting, soft = false }: {
  planName: string | null;
  limit: number | null;
  used: number;
  ownCount: number;
  slots: { listingId: string; name: string; ownerName: string }[];
  waiting: number;
  /** Soft mode (counter only, the default): "Office boats in use: 7 of 5 on Starter (over by 2)". */
  soft?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function release(listingId: string, name: string) {
    if (!window.confirm(soft
      ? `Stop counting ${name}? It is counted again the next time a paid tool is used on it. Nothing is switched off.`
      : `Release ${name}'s slot? The boat locks for its owner until the company admin uses a tool on it again.`)) return;
    setBusy(listingId);
    setError(null);
    try {
      const res = await fetch("/api/admin/cover-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error ?? `Couldn't release it (${res.status}).`);
      else router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 text-xs text-ink-600">
      {soft ? (
        <p className="font-medium text-ink-700">
          Office boats in use: {used}{limit == null ? "" : ` of ${limit}`} on {planName ?? "their plan"}
          {limit != null && used > limit ? ` (over by ${used - limit})` : ""}
        </p>
      ) : (
      <p className="font-medium text-ink-700">
        Office slots: {used} of {limit == null ? "unlimited" : limit} in use on {planName ?? "their plan"}
        {ownCount > 0 ? ` (${ownCount} own)` : ""}
        {waiting > 0 ? ` · ${waiting} office boat${waiting === 1 ? "" : "s"} waiting` : ""}
      </p>
      )}
      {slots.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {slots.map((s) => (
            <li key={s.listingId} className="flex items-center gap-2">
              <Link href={`/admin/listings/${s.listingId}`} className="text-accent-700 hover:underline">{s.name}</Link>
              {s.ownerName && <span className="text-ink-400">{s.ownerName}</span>}
              <button
                type="button"
                onClick={() => release(s.listingId, s.name)}
                disabled={busy !== null}
                className="ml-auto text-ink-500 hover:text-danger-700 border border-hairline-strong rounded-ctl px-2 py-0.5 disabled:opacity-50"
              >
                {busy === s.listingId ? "Releasing…" : "Release"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 flex items-start gap-2 text-danger-700 bg-danger-50 border border-danger-200 rounded-ctl px-2 py-1.5">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="leading-none">×</button>
        </p>
      )}
    </div>
  );
}
