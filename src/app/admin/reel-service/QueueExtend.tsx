"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Queue → "Extend": push a paid boat's next Stripe charge out by 1–30 days
 * (POST /api/admin/reel-service { action: "extend" }). No charge or credit;
 * the current paid period simply runs longer. Logged on the boat's note.
 */
export default function QueueExtend({ listingId, boat }: { listingId: string; boat: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function go() {
    const n = Math.round(Number(days));
    if (!Number.isFinite(n) || n < 1 || n > 30) { setMsg("1–30 days."); return; }
    if (!window.confirm(`Push ${boat}'s next charge out by ${n} day${n === 1 ? "" : "s"}? Nothing is charged or refunded.`)) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/admin/reel-service", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "extend", listingId, days: n }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error ?? "Couldn’t extend."); return; }
      setMsg(`Next charge ${new Date(d.nextCharge).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}.`);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="ml-2 inline-flex items-center gap-1 text-xs">
      {open ? (
        <>
          <input type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} disabled={busy}
            className="w-14 border border-hairline-strong rounded-ctl px-1.5 py-0.5 text-xs text-ink-900" aria-label="Days to extend" />
          <button type="button" onClick={go} disabled={busy} className="font-semibold text-accent-700 hover:underline disabled:opacity-50">{busy ? "…" : "Extend"}</button>
          <button type="button" onClick={() => setOpen(false)} disabled={busy} className="text-ink-500 hover:underline">×</button>
        </>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="font-semibold text-accent-700 hover:underline">Extend</button>
      )}
      {msg && <span className="text-ink-500">{msg}</span>}
    </span>
  );
}
