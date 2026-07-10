"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PLANS } from "@/lib/plans";
import HelpTip from "@/components/HelpTip";
import { Badge } from "@/components/ui";
import { getAccessStatus } from "@/lib/subscriptionAccess";

type Subscription = {
  status: string | null;
  stripe_price_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  plan: string | null;
};

export default function BillingPage() {
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const success = searchParams?.get("success") === "1";
  const cancelled = searchParams?.get("cancelled") === "1";

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("subscriptions").select("status, stripe_price_id, stripe_subscription_id, current_period_end, trial_ends_at, plan").eq("broker_id", user.id).single();
      setSub(data ?? null);
      setLoading(false);
    }
    load();
  }, []);

  const currentPlan = PLANS.find((p) => p.priceId === sub?.stripe_price_id);
  const isActive = sub?.status === "active" || sub?.status === "trialing";
  const accessStatus = getAccessStatus(sub ?? null);
  const trialExpired = accessStatus === "trial_expired";

  async function startCheckout(priceId: string) {
    setCheckoutLoading(priceId);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priceId }) });
      const text = await res.text();
      let data: { url?: string; error?: string };
      try { data = JSON.parse(text); } catch { alert(`Unexpected response: ${text.slice(0, 200)}`); return; }
      if (data.error) { alert(`Error: ${data.error}`); return; }
      if (!data.url) { alert("No checkout URL returned"); return; }
      window.location.href = data.url;
    } catch (err) { alert(`Request failed: ${String(err)}`); }
    finally { setCheckoutLoading(null); }
  }

  async function openPortal() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const { url, error } = await res.json();
      if (error) { alert(error); return; }
      window.location.href = url;
    } finally { setPortalLoading(false); }
  }

  if (loading) {
    return (
      <div className="px-6 py-8 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-ink-100 rounded-ctl w-48" />
          <div className="h-4 bg-ink-100 rounded-ctl w-72" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <div className="mb-8 pb-6 border-b border-hairline">
        <h1 className="text-display text-ink-900">Billing</h1>
        <p className="text-ink-500 mt-1 text-sm">Manage your subscription and payment details.</p>
      </div>

      {success && (
        <div className="mb-6 bg-success-50 border border-success-200 rounded-card px-5 py-4 flex items-center gap-3">
          <span className="text-success-600 text-lg">&#10003;</span>
          <div>
            <p className="text-sm font-semibold text-success-700">You&apos;re all set!</p>
            <p className="text-xs text-success-600 mt-0.5">Your subscription is active. Enjoy your 30-day free trial.</p>
          </div>
        </div>
      )}
      {cancelled && (
        <div className="mb-6 bg-warn-50 border border-warn-200 rounded-card px-5 py-4">
          <p className="text-sm text-warn-800">Checkout was cancelled -- your plan has not changed.</p>
        </div>
      )}

      {isActive && currentPlan && (
        <div className="mb-8 bg-white border border-hairline rounded-card shadow-elev-1 px-6 py-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="label-caps mb-1">Current Plan</p>
              <p className="text-lg font-semibold text-ink-900">{currentPlan.name}</p>
              <p className="text-sm text-ink-500 mt-0.5">{currentPlan.description}</p>
              {sub?.current_period_end && (
                <p className="text-xs text-ink-500 mt-2">
                  {sub.status === "trialing" ? "Trial ends" : "Renews"}{" "}
                  {new Date(sub.current_period_end).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {sub?.status === "trialing" && <Badge tone="info">Free Trial</Badge>}
              {sub?.status === "active" && <Badge tone="success">Active</Badge>}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-hairline">
            <button onClick={openPortal} disabled={portalLoading} className="text-sm font-medium text-accent-700 hover:text-accent-600 transition-colors duration-fast ease-quiet disabled:opacity-50">
              {portalLoading ? "Opening..." : "Manage billing & invoices →"}
            </button>
          </div>
        </div>
      )}

      {sub?.status === "past_due" && (
        <div className="mb-6 bg-danger-50 border border-danger-200 rounded-card px-5 py-4">
          <p className="text-sm font-semibold text-danger-700">Payment failed</p>
          <p className="text-xs text-danger-600 mt-0.5">Please update your payment method to keep access to your slideshows.</p>
          <button onClick={openPortal} className="mt-3 text-sm font-medium text-danger-700 underline">Update payment method</button>
        </div>
      )}
      {sub?.status === "canceled" && (
        <div className="mb-6 bg-ink-50 border border-hairline rounded-card px-5 py-4">
          <p className="text-sm text-ink-600">Your subscription has been cancelled. Choose a plan below to reactivate.</p>
        </div>
      )}

      {/* Free vs paid callout */}
      <div className="mb-8 bg-accent-50 border border-accent-200 rounded-card px-5 py-4 flex gap-4">
        <div className="shrink-0 text-accent-700 text-xl mt-0.5">&#9875;</div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold text-ink-900">Photo downloads are always free</p>
            <HelpTip text="Viewing and downloading photos is always free — whether uploaded by you or delivered by YachtPics." detail="A paid plan is only required to upload your own photos or build client slideshows." position="below" width={280} />
          </div>
          <p className="text-sm text-ink-600">
            Viewing and downloading photos is always free. A paid plan unlocks uploading your own photos and the slideshow builder — whether or not you&apos;ve booked a shoot.
          </p>
        </div>
      </div>

      {/* Trial expired callout */}
      {trialExpired && (
        <div className="mb-8 bg-danger-50 border border-danger-200 rounded-card px-5 py-5">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-danger-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-danger-700">Your free trial has ended</p>
              <p className="text-xs text-danger-600 mt-1">
                Photo uploads, video uploads, and slideshow sharing are paused until you subscribe. Your existing photos and listings are safe — choose a plan below to reactivate.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Plan grid */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="label-caps">{isActive ? "Change Plan" : "Choose a Plan"}</h2>
          <HelpTip text="Pick the plan that matches your active listing count. You can switch plans anytime." position="below" width={240} />
        </div>
        <p className="text-xs text-ink-500 mb-5">All plans include a 30-day free trial. Cancel anytime.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = sub?.stripe_price_id === plan.priceId && isActive;
            return (
              <div key={plan.id} className={`relative bg-white rounded-card border shadow-elev-1 px-5 py-5 flex flex-col transition-colors duration-fast ease-quiet ${isCurrent ? "border-accent-500 ring-1 ring-accent-500" : "border-hairline-strong hover:border-ink-400"}`}>
                {isCurrent && (
                  <span className="absolute -top-2.5 left-4 text-[10px] font-bold uppercase tracking-caps bg-accent-500 text-ink-950 px-2 py-0.5 rounded-full">Current</span>
                )}
                <p className="font-semibold text-ink-900 text-base">{plan.name}</p>
                <p className="text-xs text-ink-500 mt-0.5">{plan.description}</p>
                <p className="text-2xl font-light tabular-nums text-ink-900 mt-3">${plan.price}<span className="text-sm font-normal text-ink-500">/mo</span></p>
                <div className="flex-1" />
                <button
                  onClick={() => startCheckout(plan.priceId)}
                  disabled={isCurrent || checkoutLoading === plan.priceId}
                  className={`mt-4 w-full py-2.5 rounded-ctl text-sm font-semibold transition-colors duration-fast ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 ${isCurrent ? "bg-ink-100 text-ink-400 cursor-default" : "bg-accent-500 hover:bg-accent-400 text-ink-950"} disabled:opacity-60`}
                >
                  {checkoutLoading === plan.priceId ? "Loading..." : isCurrent ? "Current plan" : trialExpired ? "Subscribe" : isActive ? "Switch plan" : "Start free trial"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
