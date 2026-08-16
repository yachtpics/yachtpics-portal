"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

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
        <Button
          variant="secondary"
          onClick={() => go("/api/brokerage/portal")}
          disabled={busy}
          className="px-5"
        >
          {busy ? "Opening…" : "Manage billing & invoices"}
        </Button>
      ) : (
        <Button
          onClick={() => go("/api/brokerage/checkout")}
          disabled={busy}
          className="px-6"
        >
          {busy ? "Redirecting…" : "Start the Office plan — $249/mo"}
        </Button>
      )}
      {error && <p className="text-xs text-danger-600 mt-2">{error}</p>}
    </div>
  );
}
