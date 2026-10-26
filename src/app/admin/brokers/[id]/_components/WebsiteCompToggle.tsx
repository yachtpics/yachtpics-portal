"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin broker page → Website card: "Comp website" (billing_status 'comped' /
 * back to 'none'). Disabled while the website line is on the broker's paid
 * plan — that is never touched from here.
 */
export default function WebsiteCompToggle({ brokerId, comped, paid }: { brokerId: string; comped: boolean; paid: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId, comp: !comped }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Couldn’t change it."); return; }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <label className={`inline-flex items-center gap-2 text-sm ${paid ? "text-ink-400" : "text-ink-800"}`}>
        <input type="checkbox" checked={comped} disabled={busy || paid} onChange={toggle} className="h-4 w-4 accent-accent-600" />
        Comp website
      </label>
      {paid && <span className="text-xs text-ink-500">Website paid on their plan — nothing to comp.</span>}
      {error && <span className="text-xs text-danger-600">{error}</span>}
    </div>
  );
}
