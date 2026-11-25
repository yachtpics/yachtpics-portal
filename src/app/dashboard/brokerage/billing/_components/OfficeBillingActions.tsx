"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

async function openStripe(endpoint: string, body?: unknown): Promise<void> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error ?? "Something went wrong.");
  window.location.href = data.url;
}

/** Start one brokerage plan (Team / Office) through Stripe Checkout. */
export function StartPlanButton({ planId, label, disabled = false }: { planId: string; label: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      await openStripe("/api/brokerage/checkout", { plan: planId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div>
      <Button onClick={start} disabled={busy || disabled} className="px-6 w-full sm:w-auto">
        {busy ? "Redirecting…" : label}
      </Button>
      {error && <p className="text-xs text-danger-600 mt-2">{error}</p>}
    </div>
  );
}

type SwitchTo = { id: string; name: string; price: number; prominent: boolean } | null;

/**
 * For a subscribed brokerage: "Manage billing & invoices", plus the one plan
 * move the page offers (Team → Office when over Team's cap, Office → Team
 * when the office fits), with an inline Confirm / Cancel step.
 */
export default function OfficeBillingActions({ switchTo, trialing }: { switchTo: SwitchTo; trialing: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [done, setDone] = useState("");

  async function manage() {
    setBusy(true);
    setError("");
    try {
      await openStripe("/api/brokerage/portal");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function changePlan() {
    if (!switchTo) return;
    setSwitching(true);
    setError("");
    try {
      const res = await fetch("/api/brokerage/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: switchTo.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Something went wrong.");
      setDone(`You're on the ${switchTo.name} plan.`);
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSwitching(false);
    }
  }

  const switchLabel = switchTo
    ? `${switchTo.prominent ? "Move to" : "Switch to"} ${switchTo.name} — $${switchTo.price}/mo`
    : "";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={manage} disabled={busy} className="px-5">
          {busy ? "Opening…" : "Manage billing & invoices"}
        </Button>
        {switchTo && !confirming && !done && (
          switchTo.prominent ? (
            <Button onClick={() => setConfirming(true)} className="px-5">
              {switchLabel}
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-sm text-gray-500 hover:text-gray-800 underline underline-offset-2 transition-colors"
            >
              {switchLabel}
            </button>
          )
        )}
      </div>

      {switchTo && confirming && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-sm text-gray-700">
            {trialing
              ? `Your trial carries on. The ${switchTo.name} price starts when it ends.`
              : "Stripe credits or charges the difference on your next bill."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={changePlan} disabled={switching}>
              {switching ? "Switching…" : "Confirm"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={switching}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {done && <p className="text-sm text-green-700 mt-3">{done}</p>}
      {error && <p className="text-xs text-danger-600 mt-2">{error}</p>}
    </div>
  );
}
