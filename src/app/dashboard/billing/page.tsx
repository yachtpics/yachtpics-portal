"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PLANS } from "@/lib/plans";
import HelpTip from "@/components/HelpTip";

type Subscription = {
  status: string | null;
  stripe_price_id: string | null;
  current_period_end: string | null;
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
      const { data } = await supabase.from("subscriptions").select("status, stripe_price_id, current_period_end, plan").eq("broker_id", user.id).single();
      setSub(data ?? null);
      setLoading(false);
    }
    load();
  }, []);

  const currentPlan = PLANS.find((p) => p.priceId === sub?.stripe_price_id);
  const isActive = sub?.status === "active" || sub?.status === "trialing";

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
          <div className="h-8 bg-gray-100 rounded w-48" />
          <div className="h-4 bg-gray-100 rounded w-72" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="text-gray-500 mt-1 text-sm">Manage your subscription and payment details.</p>
      </div>

      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl px-5 py-4 flex items-center gap-3">
          <span className="text-green-600 text-lg">&#10003;</span>
          <div>
            <p className="text-sm font-semibold text-green-800">You&apos;re all set!</p>
            <p className="text-xs text-green-600 mt-0.5">Your subscription is active. Enjoy your 30-day free trial.</p>
          </div>
        </div>
      )}
      {cancelled && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
          <p className="text-sm text-amber-800">Checkout was cancelled -- your plan has not changed.</p>
        </div>
      )}

      {isActive && currentPlan && (
        <div className="mb-8 bg-white border border-gray-200 rounded-xl px-6 py-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Current Plan</p>
              <p className="text-lg font-bold text-gray-900">{currentPlan.name}</p>
              <p className="text-sm text-gray-500 mt-0.5">{currentPlan.description}</p>
              {sub?.current_period_end && (
                <p className="text-xs text-gray-400 mt-2">
                  {sub.status === "trialing" ? "Trial ends" : "Renews"}{" "}
                  {new Date(sub.current_period_end).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {sub?.status === "trialing" && <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">Free Trial</span>}
              {sub?.status === "active" && <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-green-50 text-green-700">Active</span>}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100">
            <button onClick={openPortal} disabled={portalLoading} className="text-sm font-medium text-[#d4a843] hover:text-[#c49a35] transition-colors disabled:opacity-50">
              {portalLoading ? "Opening..." : "Manage billing & invoices →"}
            </button>
          </div>
        </div>
      )}

      {sub?.status === "past_due" && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-5 py-4">
          <p className="text-sm font-semibold text-red-800">Payment failed</p>
          <p className="text-xs text-red-600 mt-0.5">Please update your payment method to keep access to your slideshows.</p>
          <button onClick={openPortal} className="mt-3 text-sm font-medium text-red-700 underline">Update payment method</button>
        </div>
      )}
      {sub?.status === "canceled" && (
        <div className="mb-6 bg-gray-50 border border-gray-200 rounded-xl px-5 py-4">
          <p className="text-sm text-gray-600">Your subscription has been cancelled. Choose a plan below to reactivate.</p>
        </div>
      )}

      {/* Free vs paid callout */}
      <div className="mb-8 bg-[#050b14]/[0.03] border border-[#d4a843]/40 rounded-xl px-5 py-4 flex gap-4">
        <div className="shrink-0 text-[#d4a843] text-xl mt-0.5">&#9875;</div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold text-gray-800">Photo downloads are always free</p>
            <HelpTip text="You never need a subscription to view or download photos that YachtPics delivers." detail="A paid plan is only required to upload photos or build client slideshows." position="below" width={280} />
          </div>
          <p className="text-sm text-gray-500">
            When YachtPics delivers your photos, you can view and download them at no cost. A paid plan unlocks photo uploading and the slideshow builder.
          </p>
        </div>
      </div>

      {/* Plan grid */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{isActive ? "Change Plan" : "Choose a Plan"}</h2>
          <HelpTip text="Pick the plan that matches your active listing count. You can switch plans anytime." position="below" width={240} />
        </div>
        <p className="text-xs text-gray-400 mb-5">All plans include a 30-day free trial. Cancel anytime.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = sub?.stripe_price_id === plan.priceId && isActive;
            return (
              <div key={plan.id} className={`relative bg-white rounded-xl border-2 px-5 py-5 flex flex-col transition-colors ${isCurrent ? "border-[#d4a843]" : "border-gray-200 hover:border-gray-300"}`}>
                {isCurrent && (
                  <span className="absolute -top-2.5 left-4 text-[10px] font-bold uppercase tracking-wide bg-[#d4a843] text-[#050b14] px-2 py-0.5 rounded-full">Current</span>
                )}
                <p className="font-bold text-gray-900 text-base">{plan.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{plan.description}</p>
                <p className="text-2xl font-bold text-gray-900 mt-3">${plan.price}<span className="text-sm font-normal text-gray-400">/mo</span></p>
                <div className="flex-1" />
                <button
                  onClick={() => startCheckout(plan.priceId)}
                  disabled={isCurrent || checkoutLoading === plan.priceId}
                  className={`mt-4 w-full py-2.5 rounded-lg text-sm font-semibold transition-colors ${isCurrent ? "bg-gray-100 text-gray-400 cursor-default" : "bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14]"} disabled:opacity-60`}
                >
                  {checkoutLoading === plan.priceId ? "Loading..." : isCurrent ? "Current plan" : isActive ? "Switch plan" : "Start free trial"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
