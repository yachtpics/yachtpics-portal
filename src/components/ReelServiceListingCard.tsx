"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { REEL_SERVICE_PRICE, REEL_SERVICE_REELS_PER_BOAT } from "@/lib/plans";

/**
 * "Reel Service" card on a listing (broker listing page + admin listing
 * page), next to the Boat shows card. Reads /api/reel-service/listing.
 *
 *   not on it   → "Add Reel Service — $179/mo" → Stripe Checkout
 *   paid        → "Reel Service active · N of 4 this month", renewal date,
 *                 a visible Cancel link (runs to the end of the paid month)
 *   past due    → "Payment problem — update your card" (Stripe billing portal)
 *   paused      → off until the card is fixed
 *   comped      → the badge only (no price, no cancel)
 *
 * After checkout the page arrives with ?reel_service=started and shows a
 * green banner. Before migration 20261024 is applied: "not available yet".
 */

type State = {
  ready: boolean;
  listingActive: boolean;
  state: "none" | "paid" | "paused" | "comped" | "ended";
  billingStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  deliveredThisMonth: number;
  isBroker: boolean;
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });

export default function ReelServiceListingCard({
  listingId,
  onMessage,
  className = "mb-5",
}: {
  listingId: string;
  onMessage: (text: string, kind: "success" | "error") => void;
  className?: string;
}) {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState<"" | "checkout" | "cancel" | "portal">("");
  const [confirming, setConfirming] = useState(false);
  const [started, setStarted] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/reel-service/listing?listingId=${encodeURIComponent(listingId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: State | null) => { if (d) setS(d); })
      .catch(() => {});
  }, [listingId]);

  useEffect(() => {
    load();
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("reel_service") === "started") {
      setStarted(true);
      // The webhook may land a few seconds after Stripe sends the broker back.
      const timers = [3000, 6000, 10000, 15000, 25000, 40000].map((ms) => setTimeout(load, ms));
      return () => { timers.forEach(clearTimeout); };
    }
  }, [load]);

  async function checkout() {
    setBusy("checkout");
    try {
      const res = await fetch("/api/reel-service/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) { onMessage(d.error ?? "We couldn’t open checkout just now. Please try again in a moment.", "error"); return; }
      window.location.href = d.url;
    } catch {
      onMessage("We couldn’t reach the billing service. Check your connection and try again.", "error");
    } finally {
      setBusy("");
    }
  }

  async function cancel() {
    setBusy("cancel");
    try {
      const res = await fetch("/api/reel-service/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { onMessage(d.error ?? "We couldn’t cancel just now.", "error"); return; }
      onMessage(d.endsAt ? `Reel Service cancelled. It runs until ${fmt(d.endsAt)}; nothing renews.` : "Reel Service cancelled. Nothing renews.", "success");
      setConfirming(false);
      load();
    } finally {
      setBusy("");
    }
  }

  async function updateCard() {
    setBusy("portal");
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnPath: `/dashboard/listings/${listingId}` }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) { onMessage("We couldn’t open your billing details just now. Please try again in a moment.", "error"); return; }
      window.location.href = d.url;
    } finally {
      setBusy("");
    }
  }

  if (!s) return null;

  const banner = started && (s.state === "paid" || s.state === "none") ? (
    <div role="status" className="mb-3 px-4 py-3 rounded-lg text-sm bg-success-50 border border-success-200 text-success-700">
      Reel Service is on. First reels are on the way.
    </div>
  ) : null;

  const shell = (children: React.ReactNode) => (
    <div className={className}>
      {banner}
      <div className="px-4 py-3.5 rounded-lg bg-white border border-hairline">
        <p className="label-caps text-ink-500">Reel Service</p>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );

  if (!s.ready) {
    return shell(<p className="text-sm text-ink-500">Reel Service isn&rsquo;t available to order here yet.</p>);
  }

  const badge = (text: string, tone: "ok" | "warn" | "bad" = "ok") => (
    <span className={`inline-block text-xs font-semibold px-2 py-1 rounded ${tone === "ok" ? "bg-success-50 text-success-700" : tone === "warn" ? "bg-warn-50 text-warn-800" : "bg-danger-50 text-danger-700"}`}>{text}</span>
  );
  const countLine = `Reel Service active · ${Math.min(s.deliveredThisMonth, REEL_SERVICE_REELS_PER_BOAT)} of ${REEL_SERVICE_REELS_PER_BOAT} this month`;

  if (s.state === "comped") {
    return shell(
      <div className="space-y-1">
        {badge(countLine)}
        <p className="text-xs text-ink-500">Your reels land on Your Reels and in your inbox.</p>
      </div>
    );
  }

  if (s.state === "paid") {
    const pastDue = s.billingStatus === "past_due";
    return shell(
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {badge(countLine, pastDue ? "warn" : "ok")}
          {s.currentPeriodEnd && (
            <span className="text-xs text-ink-500">
              {s.cancelAtPeriodEnd ? `Ends ${fmt(s.currentPeriodEnd)}` : `Renews ${fmt(s.currentPeriodEnd)} · $${REEL_SERVICE_PRICE}/mo`}
            </span>
          )}
        </div>
        {pastDue && (
          <p className="text-sm text-warn-800">
            Payment problem &mdash;{" "}
            {s.isBroker ? (
              <button type="button" onClick={updateCard} disabled={!!busy} className="font-semibold underline disabled:opacity-50">
                {busy === "portal" ? "Opening…" : "update your card"}
              </button>
            ) : (
              <span>the broker needs to update their card under Billing.</span>
            )}
          </p>
        )}
        <p className="text-xs text-ink-500">Reels land on Your Reels and in your inbox.</p>
        {!s.cancelAtPeriodEnd && (
          <button type="button" onClick={() => setConfirming(true)} disabled={!!busy}
            className="text-xs font-semibold text-danger-700 hover:underline disabled:opacity-50">
            Cancel Reel Service
          </button>
        )}
        <ConfirmDeleteDialog
          open={confirming}
          title="Cancel Reel Service?"
          body={s.currentPeriodEnd
            ? `Reels keep coming until ${fmt(s.currentPeriodEnd)}, the end of the month you’ve paid for. Nothing renews after that. Reels already delivered stay on Your Reels.`
            : "Nothing renews after the month you’ve paid for. Reels already delivered stay on Your Reels."}
          confirmLabel="Cancel Reel Service"
          busyLabel="Cancelling…"
          busy={busy === "cancel"}
          onConfirm={cancel}
          onCancel={() => setConfirming(false)}
        />
      </div>
    );
  }

  if (s.state === "paused") {
    return shell(
      <div className="space-y-2">
        {badge("Reel Service paused", "bad")}
        <p className="text-sm text-ink-700">
          The last payment didn&rsquo;t go through, so no new reels are being made.{" "}
          {s.isBroker ? (
            <button type="button" onClick={updateCard} disabled={!!busy} className="font-semibold text-accent-700 underline disabled:opacity-50">
              {busy === "portal" ? "Opening…" : "Update your card"}
            </button>
          ) : (
            <span>The broker can update their card under Billing.</span>
          )}
        </p>
      </div>
    );
  }

  // Just back from a paid checkout and the webhook hasn't landed yet: don't offer it again.
  if (started && (s.state === "none" || s.state === "ended")) {
    return shell(<p className="text-sm text-ink-600">Setting up the Reel Service for this boat &mdash; this takes a few seconds.</p>);
  }

  // none / ended → offer it (active listings only).
  if (!s.listingActive) {
    return null;
  }
  return shell(
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink-700">
        <span className="font-medium text-ink-900">Add Reel Service &mdash; ${REEL_SERVICE_PRICE}/mo</span>
        <span className="text-ink-500"> &middot; up to {REEL_SERVICE_REELS_PER_BOAT} reels a month, made by YachtPics from this shoot</span>
      </p>
      <button type="button" onClick={checkout} disabled={!!busy}
        className="text-sm font-semibold px-4 py-2 rounded-ctl bg-accent-500 hover:bg-accent-400 text-ink-950 transition-colors duration-fast disabled:opacity-50">
        {busy === "checkout" ? "Opening checkout…" : "Add Reel Service"}
      </button>
    </div>
  );
}
