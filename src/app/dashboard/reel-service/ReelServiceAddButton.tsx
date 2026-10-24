"use client";

import { useState } from "react";
import { REEL_SERVICE_PRICE } from "@/lib/plans";

/** "Add — $179/mo" → Stripe Checkout for one boat (/api/reel-service/checkout). */
export default function ReelServiceAddButton({ listingId }: { listingId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/reel-service/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) { setErr(d.error ?? "We couldn’t open checkout just now."); return; }
      window.location.href = d.url;
    } catch {
      setErr("We couldn’t reach the billing service. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="text-right">
      <button type="button" onClick={go} disabled={busy}
        className="text-sm font-semibold px-4 py-2 rounded-ctl bg-accent-500 hover:bg-accent-400 text-ink-950 transition-colors disabled:opacity-50">
        {busy ? "Opening checkout…" : `Add — $${REEL_SERVICE_PRICE}/mo`}
      </button>
      {err && <p role="alert" className="mt-1 text-xs text-danger-700 max-w-[16rem]">{err}</p>}
    </div>
  );
}
