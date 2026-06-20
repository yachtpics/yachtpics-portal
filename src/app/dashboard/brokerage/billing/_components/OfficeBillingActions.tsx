"use client";

import { useState } from "react";

export default function OfficeBillingActions({ active }: { active: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go(endpoint: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "Something went wrong.");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div>
      {active ? (
        <button
          onClick={() => go("/api/brokerage/portal")}
          disabled={busy}
          className="bg-white border border-gray-200 hover:border-[#d4a843] disabled:opacity-50 text-gray-700 text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
        >
          {busy ? "Opening…" : "Manage billing & invoices"}
        </button>
      ) : (
        <button
          onClick={() => go("/api/brokerage/checkout")}
          disabled={busy}
          className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
        >
          {busy ? "Redirecting…" : "Start the Office plan — $249/mo"}
        </button>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
