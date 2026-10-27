"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PLANS, REEL_SERVICE_PRICE, REEL_SERVICE_REELS_PER_BOAT, WEBSITE_PRICE, WEBSITE_INCLUDED_PLANS, planIncludesWebsite, planPriceWithWebsite } from "@/lib/plans";
import HelpTip from "@/components/HelpTip";
import { Badge } from "@/components/ui";
import { getAccessStatus, trialDaysFor } from "@/lib/subscriptionAccess";

type Subscription = {
  status: string | null;
  stripe_price_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  created_at: string | null;
};

/** Website billing state from /api/website?summary=1 (see src/lib/websiteAddon.ts). */
type WebsiteState = {
  live: boolean;
  reason: "elite" | "website" | "comped" | "no_plan" | "no_website";
  ready: boolean;
  onPlan: boolean;
  endsAt: string | null;
  currentPeriodEnd: string | null;
  canAddToPlan: boolean;
} | null;

export default function BillingPage() {
  const [sub, setSub] = useState<Subscription | null>(null);
  const [website, setWebsite] = useState<WebsiteState>(null);
  /** Listing-range nudge (src/lib/listingAllowance.ts) — never blocks anything. */
  const [allowance, setAllowance] = useState<{ over: boolean; message: string | null; suggestedPlan: { id: string; name: string; price: number; priceId: string } | null } | null>(null);
  const [websiteBusy, setWebsiteBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const success = searchParams?.get("success") === "1";
  const successWithWebsite = searchParams?.get("website") === "1";
  const cancelled = searchParams?.get("cancelled") === "1";
  // Set by the checkout route when Stripe was told not to charge until the
  // in-app trial ends (unix seconds).
  const trialEndParam = Number(searchParams?.get("trial_end") ?? "");
  const billingStartsOn = Number.isFinite(trialEndParam) && trialEndParam > 0 ? new Date(trialEndParam * 1000) : null;

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("subscriptions").select("status, stripe_price_id, stripe_subscription_id, current_period_end, trial_ends_at, created_at").eq("broker_id", user.id).single();
      setSub(data ?? null);
      setLoading(false);
      // Website line state (Oct 26). Missing / not set up → the page just
      // offers "plan + website" checkouts.
      const w = await fetch("/api/website?summary=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      setWebsite((w?.entitlement as WebsiteState) ?? null);
      const a = await fetch("/api/billing/allowance", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      setAllowance(a);
    }
    load();
  }, []);

  async function reloadWebsite() {
    const w = await fetch("/api/website?summary=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setWebsite((w?.entitlement as WebsiteState) ?? null);
  }

  async function addWebsite(planName: string, total: number, paidThrough: boolean) {
    const msg = paidThrough
      ? "Keep your website? It stays on your plan and renews with it."
      : `Add your website to ${planName}? Your plan becomes $${total}/mo. The rest of this month is charged pro rata on your next invoice.`;
    if (!confirm(msg)) return;
    setWebsiteBusy(true);
    setActionError("");
    try {
      const res = await fetch("/api/website/add", { method: "POST" });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) { setActionError(data.error ?? "We couldn't add the website just now."); return; }
      await reloadWebsite();
    } finally { setWebsiteBusy(false); }
  }

  async function removeWebsite() {
    const until = website?.currentPeriodEnd ? fmtDate(new Date(website.currentPeriodEnd)) : "the end of the month you've paid for";
    if (!confirm(`Remove the website from your plan? It stays live until ${until}, then goes offline, and it won't renew.`)) return;
    setWebsiteBusy(true);
    setActionError("");
    try {
      const res = await fetch("/api/website/remove", { method: "POST" });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) { setActionError(data.error ?? "We couldn't remove the website just now."); return; }
      await reloadWebsite();
    } finally { setWebsiteBusy(false); }
  }

  const currentPlan = PLANS.find((p) => p.priceId === sub?.stripe_price_id);
  const isActive = sub?.status === "active" || sub?.status === "trialing";
  const accessStatus = getAccessStatus(sub ?? null);
  const trialExpired = accessStatus === "trial_expired";
  // A real Stripe plan is attached (as opposed to the in-app trial, which has
  // status "trialing" but no Stripe subscription).
  const hasPlan = !!sub?.stripe_subscription_id && isActive;
  // Any live plan subscription (incl. past due): tier changes go through
  // change-plan, never a second Checkout.
  const hasStripeSub = !!sub?.stripe_subscription_id && ["active", "trialing", "past_due"].includes(sub?.status ?? "");
  const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  // In-app trial still running? Mirrors the checkout route: Stripe needs the
  // trial end at least 48 hours out, otherwise billing starts at checkout.
  const inAppTrialEnd =
    !hasPlan && sub?.status === "trialing" && sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() > Date.now()
      ? new Date(sub.trial_ends_at)
      : null;
  const trialDeferrable = !!inAppTrialEnd && inAppTrialEnd.getTime() - Date.now() >= 49 * 60 * 60 * 1000;
  // This broker's trial length: 14 days, or 30 for accounts opened before Oct 24 2026.
  const trialDays = trialDaysFor(sub);

  /**
   * Existing subscribers change tier on their CURRENT subscription (Oct 26):
   * /api/stripe/change-plan swaps the plan item (and adds / removes the
   * website line). Only brokers with no plan subscription go to Checkout.
   */
  async function changePlan(plan: { name: string; price: number; priceId: string }, withWebsite: boolean) {
    const toIncluded = planIncludesWebsite(plan.name);
    const total = withWebsite || toIncluded ? planPriceWithWebsite(plan) : plan.price;
    const notes: string[] = [];
    if (toIncluded && website?.onPlan) notes.push(`${plan.name} includes your website, so the separate $${WEBSITE_PRICE} line comes off.`);
    const leavingWebsite = !withWebsite && !toIncluded && (website?.onPlan || website?.reason === "elite");
    if (leavingWebsite) {
      const until = website?.currentPeriodEnd ? fmtDate(new Date(website.currentPeriodEnd)) : "the end of this month";
      notes.push(`Your website stays live until ${until}, then goes offline.`);
    }
    const msg = `Switch to ${plan.name}${withWebsite && !toIncluded ? " + Website" : ""}? Your plan becomes $${total}/mo. The difference for the rest of this month is charged or credited on your next invoice.${notes.length ? "\n\n" + notes.join(" ") : ""}`;
    if (!confirm(msg)) return;
    const key = withWebsite ? `${plan.priceId}+web` : plan.priceId;
    setCheckoutLoading(key);
    setActionError("");
    try {
      const res = await fetch("/api/stripe/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId: plan.priceId, withWebsite: toIncluded ? undefined : withWebsite }),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) { setActionError(data.error ?? "We couldn't change your plan just now."); return; }
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: fresh } = await supabase.from("subscriptions").select("status, stripe_price_id, stripe_subscription_id, current_period_end, trial_ends_at, created_at").eq("broker_id", user.id).single();
        setSub(fresh ?? null);
      }
      await reloadWebsite();
    } finally { setCheckoutLoading(null); }
  }

  async function startCheckout(priceId: string, withWebsite = false) {
    setCheckoutLoading(withWebsite ? `${priceId}+web` : priceId);
    setActionError("");
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priceId, withWebsite }) });
      const text = await res.text();
      let data: { url?: string; error?: string } = {};
      try { data = JSON.parse(text); } catch { /* handled below */ }
      if (!res.ok || data.error || !data.url) {
        console.error("Checkout failed:", data.error ?? text.slice(0, 200));
        setActionError("We couldn't open checkout just now. Please try again in a moment, or contact YachtPics if it continues.");
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      console.error("Checkout request failed:", err);
      setActionError("We couldn't reach the billing service. Check your connection and try again.");
    } finally { setCheckoutLoading(null); }
  }

  async function openPortal() {
    setPortalLoading(true);
    setActionError("");
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json().catch(() => ({} as { url?: string; error?: string }));
      if (!res.ok || data.error || !data.url) {
        console.error("Billing portal failed:", data.error);
        setActionError("We couldn't open your billing details just now. Please try again in a moment.");
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      console.error("Billing portal request failed:", err);
      setActionError("We couldn't reach the billing service. Check your connection and try again.");
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
            <p className="text-sm font-semibold text-success-700">{successWithWebsite ? "Your plan and website are active." : "Your plan is active."}</p>
            {billingStartsOn && (
              <p className="text-xs text-success-600 mt-0.5">Billing starts when your trial ends on {fmtDate(billingStartsOn)}.</p>
            )}
          </div>
        </div>
      )}
      {cancelled && (
        <div className="mb-6 bg-warn-50 border border-warn-200 rounded-card px-5 py-4">
          <p className="text-sm text-warn-800">Checkout was cancelled. Your plan has not changed.</p>
        </div>
      )}

      {/* Over the plan's listing range — a calm nudge, nothing is blocked. */}
      {allowance?.over && allowance.message && allowance.suggestedPlan && (
        <div className="mb-6 bg-white border border-accent-200 rounded-card px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-700">{allowance.message}</p>
          {(() => {
            const target = PLANS.find((p) => p.priceId === allowance.suggestedPlan!.priceId);
            if (!target) return null;
            // Keeps the website line exactly as it is (on stays on, off stays off).
            return (
              <button
                onClick={async () => {
                  await changePlan(target, !!website?.onPlan);
                  const a = await fetch("/api/billing/allowance", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
                  setAllowance(a);
                }}
                disabled={!!checkoutLoading}
                className="shrink-0 text-sm font-semibold px-4 py-2 rounded-ctl bg-accent-500 hover:bg-accent-400 text-ink-950 transition-colors disabled:opacity-50"
              >
                Upgrade to {target.name}
              </button>
            );
          })()}
        </div>
      )}

      {actionError && (
        <p role="alert" className="mb-6 text-sm text-danger-600 bg-danger-50 border border-danger-200 rounded-ctl px-4 py-3">{actionError}</p>
      )}

      {isActive && currentPlan && (
        <div className="mb-8 bg-white border border-hairline rounded-card shadow-elev-1 px-6 py-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="label-caps mb-1">Current Plan</p>
              <p className="text-lg font-semibold text-ink-900">
                {currentPlan.name}
                {(planIncludesWebsite(currentPlan.name) || website?.onPlan) && <span className="text-sm font-normal text-ink-500"> + Website</span>}
              </p>
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
            <HelpTip text="Every photograph YachtPics delivers is yours to view and download, free, with or without a plan." detail="A plan adds the tools: buyer slideshows, unlimited reels, Seller Reports, boat-show dock cards and your own listings." position="below" width={280} />
          </div>
          <p className="text-sm text-ink-600">
            Every photograph we deliver is yours to download, free, plan or no plan. A plan adds the tools that put them to work: buyer slideshows you send to clients, unlimited reels, a Seller Report for every listing, boat-show dock cards, and your own listings with your own photos for boats we didn&apos;t shoot.
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
          <h2 className="label-caps">{hasPlan ? "Change Plan" : "Choose a Plan"}</h2>
          <HelpTip text="Pick the plan that matches your active listing count. You can switch plans anytime." position="below" width={240} />
        </div>
        <p className="text-xs text-ink-500 mb-5">
          {inAppTrialEnd && trialDeferrable
            ? `Your ${trialDays}-day free trial runs until ${fmtDate(inAppTrialEnd)}. Choose a plan now and you won't be charged until then. Cancel anytime.`
            : inAppTrialEnd
              ? `Your ${trialDays}-day free trial ends ${fmtDate(inAppTrialEnd)}. Choosing a plan now starts billing today. Cancel anytime.`
              : "Billed monthly. Cancel anytime."}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => {
            const isCurrentPlan = sub?.stripe_price_id === plan.priceId && (isActive || hasStripeSub);
            const included = planIncludesWebsite(plan.name);
            const websiteOn = included || !!website?.onPlan;
            const total = planPriceWithWebsite(plan);
            const btn = (primary: boolean) =>
              `w-full py-2.5 rounded-ctl text-sm font-semibold transition-colors duration-fast ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 disabled:opacity-60 ${
                primary ? "bg-accent-500 hover:bg-accent-400 text-ink-950" : "border border-hairline-strong text-ink-800 hover:border-ink-400"
              }`;
            const chooseLabel = hasStripeSub ? "Change plan" : trialExpired ? "Subscribe" : inAppTrialEnd ? "Choose plan" : "Subscribe";
            return (
              <div key={plan.id} className={`relative bg-white rounded-card border shadow-elev-1 px-5 py-5 flex flex-col transition-colors duration-fast ease-quiet ${isCurrentPlan ? "border-accent-500 ring-1 ring-accent-500" : "border-hairline-strong hover:border-ink-400"}`}>
                {isCurrentPlan && (
                  <span className="absolute -top-2.5 left-4 text-[10px] font-bold uppercase tracking-caps bg-accent-500 text-ink-950 px-2 py-0.5 rounded-full">Current</span>
                )}
                <p className="font-semibold text-ink-900 text-base">{plan.name}</p>
                <p className="text-xs text-ink-500 mt-0.5">{plan.description}</p>

                {!included && (
                  <div className="mt-4 pb-4 border-b border-hairline">
                    <p className="text-[0.6875rem] uppercase tracking-caps text-ink-500">Portal</p>
                    <p className="text-2xl font-light tabular-nums text-ink-900 mt-1">${plan.price}<span className="text-sm font-normal text-ink-500">/mo</span></p>
                    {isCurrentPlan && !websiteOn ? (
                      <p className="mt-3 text-xs font-semibold text-ink-500 text-center py-2.5">Your plan</p>
                    ) : isCurrentPlan && website?.onPlan ? (
                      <button onClick={removeWebsite} disabled={websiteBusy} className={"mt-3 " + btn(false)}>
                        {websiteBusy ? "…" : "Remove website"}
                      </button>
                    ) : (
                      <button onClick={() => (hasStripeSub ? changePlan(plan, false) : startCheckout(plan.priceId))} disabled={checkoutLoading === plan.priceId} className={"mt-3 " + btn(false)}>
                        {checkoutLoading === plan.priceId ? "Loading..." : chooseLabel}
                      </button>
                    )}
                  </div>
                )}

                <div className={included ? "mt-4" : "mt-4"}>
                  <p className="text-[0.6875rem] uppercase tracking-caps text-accent-700">Portal + Website</p>
                  <p className="text-2xl font-light tabular-nums text-ink-900 mt-1">${total}<span className="text-sm font-normal text-ink-500">/mo</span></p>
                  {included && <p className="text-xs font-semibold text-accent-700 mt-1">Includes your own website</p>}
                  {isCurrentPlan && websiteOn ? (
                    <p className="mt-3 text-xs font-semibold text-ink-500 text-center py-2.5">
                      {website?.endsAt ? `Website live until ${fmtDate(new Date(website.endsAt))}` : "Your plan"}
                    </p>
                  ) : null}
                  {isCurrentPlan && website?.endsAt && !included && (
                    <button onClick={() => addWebsite(plan.name, total, true)} disabled={websiteBusy} className={"mt-1 " + btn(true)}>
                      {websiteBusy ? "…" : "Keep website"}
                    </button>
                  )}
                  {isCurrentPlan && !websiteOn && !website?.endsAt && (
                    <button onClick={() => addWebsite(plan.name, total, false)} disabled={websiteBusy || !website?.canAddToPlan} className={"mt-3 " + btn(true)}>
                      {websiteBusy ? "Adding…" : `Add website — +$${WEBSITE_PRICE}/mo`}
                    </button>
                  )}
                  {!isCurrentPlan && (
                    <button onClick={() => (hasStripeSub ? changePlan(plan, !included) : startCheckout(plan.priceId, !included))} disabled={checkoutLoading === `${plan.priceId}+web` || checkoutLoading === plan.priceId} className={"mt-3 " + btn(true)}>
                      {checkoutLoading === `${plan.priceId}+web` || (included && checkoutLoading === plan.priceId) ? "Loading..." : `${chooseLabel} with website`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Reel Service (Oct 24) — an add-on per listing, not a plan. Bought
            on the boat's page (or /dashboard/reel-service); includes Portal
            access while active for a broker with no plan. */}
        <div className="mt-4 bg-white rounded-card border border-hairline-strong shadow-elev-1 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-ink-900 text-base">Add Reel Service <span className="text-sm font-normal text-ink-500">&middot; ${REEL_SERVICE_PRICE}/mo per listing</span></p>
            <p className="text-xs text-ink-500 mt-0.5">
              Up to {REEL_SERVICE_REELS_PER_BOAT} social reels a month, made by YachtPics from the shoot. Per listing; pick the boat on its page. Includes Portal access while it&rsquo;s on if you don&rsquo;t have a plan.
            </p>
          </div>
          <a href="/dashboard/reel-service" className="text-sm font-semibold px-4 py-2 rounded-ctl border border-hairline-strong text-ink-800 hover:border-ink-400 transition-colors">
            Pick a boat
          </a>
        </div>

        {/* Website (Oct 26) — a $50/mo line on the plan; Elite includes it.
            Chosen with the plan above, or added / removed here for a
            current subscriber. Edited on Dashboard → Website. */}
        <div className="mt-4 bg-white rounded-card border border-hairline-strong shadow-elev-1 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-2xl">
            <p className="font-semibold text-ink-900 text-base">Your own website <span className="text-sm font-normal text-ink-500">&middot; +${WEBSITE_PRICE} a month on any plan</span></p>
            <p className="text-xs text-ink-500 mt-0.5">
              Your boats on your own site — ours and the ones you photograph yourself — updating themselves from the Portal. Showing requests and inquiries straight to your inbox. Recent sales, testimonials and a &lsquo;what&rsquo;s my boat worth&rsquo; form for sellers.
            </p>
            <p className="text-xs font-semibold text-accent-700 mt-1">Included with {WEBSITE_INCLUDED_PLANS.join(" or ")}.</p>
            {website?.onPlan && <p className="text-xs text-success-700 mt-1">On your plan{website.currentPeriodEnd ? ` · renews ${fmtDate(new Date(website.currentPeriodEnd))}` : ""}.</p>}
            {website?.endsAt && <p className="text-xs text-warn-800 mt-1">Removed — stays live until {fmtDate(new Date(website.endsAt))}.</p>}
            {website?.reason === "comped" && <p className="text-xs text-success-700 mt-1">On at no charge.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {website?.onPlan && (
              <button onClick={removeWebsite} disabled={websiteBusy} className="text-sm font-semibold px-4 py-2 rounded-ctl border border-hairline-strong text-ink-800 hover:border-ink-400 transition-colors disabled:opacity-50">
                {websiteBusy ? "…" : `Remove website (stays live until ${website.currentPeriodEnd ? fmtDate(new Date(website.currentPeriodEnd)) : "the end of this month"})`}
              </button>
            )}
            {!website?.onPlan && !website?.endsAt && website?.canAddToPlan && currentPlan && (
              <button onClick={() => addWebsite(currentPlan.name, planPriceWithWebsite(currentPlan), false)} disabled={websiteBusy} className="text-sm font-semibold px-4 py-2 rounded-ctl bg-accent-500 hover:bg-accent-400 text-ink-950 transition-colors disabled:opacity-50">
                {websiteBusy ? "Adding…" : `Add website — +$${WEBSITE_PRICE}/mo`}
              </button>
            )}
            <a href="/dashboard/website" className="text-sm font-semibold px-4 py-2 rounded-ctl border border-hairline-strong text-ink-800 hover:border-ink-400 transition-colors">
              Open Website
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
