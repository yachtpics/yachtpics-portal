"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PLANS, WEBSITE_INCLUDED_PLANS, WEBSITE_PRICE, planPriceWithWebsite } from "@/lib/plans";

/**
 * The top card on Dashboard → Website (owner decision, Oct 26): the website is
 * a $50/month line on the broker's Portal plan — Starter $79, Growth $99,
 * Pro $129 with it; Elite includes it — or an admin comp. The editor works
 * either way; this card says what's needed to go live and offers the button.
 */

export type Entitlement = {
  live: boolean;
  reason: "elite" | "website" | "comped" | "no_plan" | "no_website";
  ready: boolean;
  portalAccess: boolean;
  elite: boolean;
  billingStatus: "none" | "active" | "past_due" | "canceled" | "comped";
  onPlan: boolean;
  endsAt: string | null;
  currentPeriodEnd: string | null;
  planName: string | null;
  planPrice: number | null;
  canAddToPlan: boolean;
};

const inkBtn =
  "inline-flex items-center justify-center gap-2 min-h-[44px] px-5 bg-ink-950 hover:bg-ink-800 disabled:opacity-40 disabled:pointer-events-none text-white text-sm font-medium rounded-ctl transition-colors duration-fast ease-quiet";
const quietBtn =
  "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 border border-hairline-strong text-ink-800 hover:bg-ink-50 disabled:opacity-40 disabled:pointer-events-none text-sm font-medium rounded-ctl transition-colors duration-fast ease-quiet";

function fmt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

const withWebsiteLine = PLANS.map((p) => `${p.name} $${planPriceWithWebsite(p)}${WEBSITE_INCLUDED_PLANS.includes(p.name) ? " (included)" : ""}`).join(" · ");

export default function WebsitePlanCard({
  ent,
  role,
  canBuy,
  isSelf,
  brokerId,
  onChanged,
}: {
  ent: Entitlement | null;
  role: "broker" | "assistant" | "admin";
  /** The signed-in broker themself — the only one who can change their plan. */
  canBuy: boolean;
  isSelf: boolean;
  brokerId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const starter = PLANS.find((p) => p.id === "starter");
  const included = WEBSITE_INCLUDED_PLANS.join(" or ");

  // ?website=add — the link an admin copies for a broker: just point at this card.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("website") !== "add") return;
    url.searchParams.delete("website");
    window.history.replaceState(null, "", url.pathname + url.search);
    setHighlight(true);
  }, []);

  if (!ent) return null;

  const total = ent.planPrice != null && ent.planName ? planPriceWithWebsite({ name: ent.planName, price: ent.planPrice }) : null;

  const add = async () => {
    const paidThrough = !!ent.endsAt;
    const msg = paidThrough
      ? "Keep your website? It stays on your plan and renews with it."
      : `Add your website to ${ent.planName}? Your plan becomes $${total}/mo. The rest of this month is charged pro rata on your next invoice.`;
    if (!confirm(msg)) return;
    setBusy("add");
    setError(null);
    try {
      const res = await fetch("/api/website/add", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.needsPlan) { window.location.href = "/dashboard/billing"; return; }
        setError(json.error ?? "We couldn’t add the website just now.");
        return;
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm(`Remove the website from your plan? It stays live until ${fmt(ent.currentPeriodEnd) || "the end of the month you’ve paid for"}, then goes offline, and it won’t renew. Everything you’ve set up is kept.`)) return;
    setBusy("remove");
    setError(null);
    try {
      const res = await fetch("/api/website/remove", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "We couldn’t remove it just now."); return; }
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const comp = async (on: boolean) => {
    setBusy("comp");
    setError(null);
    try {
      const res = await fetch(`/api/admin/website`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId, comp: on }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Couldn’t change the comp."); return; }
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy("portal");
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnPath: "/dashboard/website" }) });
      const json = await res.json().catch(() => ({}));
      if (json.url) window.location.href = json.url;
      else setError("We couldn’t open your billing details just now.");
    } finally {
      setBusy(null);
    }
  };

  const payLink = typeof window !== "undefined" ? `${window.location.origin}/dashboard/website?website=add` : "/dashboard/website?website=add";
  const notYours = role === "assistant"
    ? <p className="text-xs text-ink-600">Plan changes are made by the broker, from their Website or Billing page.</p>
    : null;
  const adminActions = (
    <>
      <button type="button" className={inkBtn} disabled={!!busy} onClick={() => comp(true)}>{busy === "comp" ? "…" : "Comp website (no charge)"}</button>
      <button
        type="button"
        className={quietBtn}
        onClick={() => { navigator.clipboard?.writeText(payLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }, () => {}); }}
      >
        {copied ? "Copied" : "Copy link for the broker"}
      </button>
    </>
  );

  let tone = "border-hairline bg-white";
  let title = "";
  let body: React.ReactNode = null;
  let actions: React.ReactNode = null;

  if (ent.reason === "elite") {
    title = `Included with ${included}`;
    body = "Your website is part of your plan. Nothing more to pay.";
  } else if (ent.reason === "comped") {
    title = "Comped — no charge";
    body = "YachtPics has switched your website on at no charge.";
    if (role === "admin") actions = <button type="button" className={quietBtn} disabled={!!busy} onClick={() => comp(false)}>{busy === "comp" ? "…" : "Remove comp"}</button>;
  } else if (ent.reason === "website") {
    const pastDue = ent.billingStatus === "past_due";
    tone = pastDue ? "border-danger-200 bg-danger-50" : "border-hairline bg-white";
    if (ent.endsAt) {
      title = `Website removed — stays live until ${fmt(ent.endsAt)}`;
      body = "It won’t renew. Changed your mind? Keep it and it stays on your plan.";
      actions = canBuy && ent.canAddToPlan ? <button type="button" className={inkBtn} disabled={!!busy} onClick={add}>{busy === "add" ? "…" : "Keep my website"}</button> : notYours;
    } else {
      title = `Website on your ${ent.planName ?? "Portal"} plan${total ? ` · $${total}/mo total` : ` · +$${WEBSITE_PRICE}/mo`}`;
      body = pastDue
        ? "Your last payment didn’t go through. Your website stays live while we retry — update your card to keep it that way."
        : ent.currentPeriodEnd ? `Renews ${fmt(ent.currentPeriodEnd)} with your plan.` : "Renews with your plan.";
      actions = canBuy ? (
        <>
          {pastDue && <button type="button" className={inkBtn} disabled={!!busy} onClick={openPortal}>{busy === "portal" ? "Opening…" : "Update your card"}</button>}
          <button type="button" className={quietBtn} disabled={!!busy} onClick={remove}>{busy === "remove" ? "Removing…" : "Remove website"}</button>
        </>
      ) : notYours;
    }
  } else if (ent.reason === "no_plan") {
    tone = "border-warn-200 bg-warn-50";
    title = starter
      ? `Your website needs a Portal plan — ${starter.name} $${starter.price} + website $${WEBSITE_PRICE} = $${planPriceWithWebsite(starter)} a month`
      : "Your website needs a Portal plan";
    body = `Choose a plan with the website in Billing: ${withWebsiteLine}.`;
    actions = canBuy ? <Link href="/dashboard/billing" className={inkBtn}>Go to Billing</Link> : role === "admin" ? <p className="text-xs text-ink-600">This broker has no Portal plan or trial.</p> : notYours;
  } else {
    // no_website
    if (ent.canAddToPlan && ent.planName && total != null) {
      title = `Add your website to ${ent.planName} — $${total}/mo total`;
      body = `+$${WEBSITE_PRICE} a month on your plan, or included with ${included}. Build it here at your own pace; it goes live once it’s on your plan and Publish is on.`;
      actions = canBuy
        ? <button type="button" className={inkBtn} disabled={!!busy} onClick={add}>{busy === "add" ? "Adding…" : `Add website — +$${WEBSITE_PRICE}/mo`}</button>
        : role === "admin" ? adminActions : notYours;
    } else {
      title = "Your website is ready to go live";
      body = !ent.ready
        ? "Adding the website isn’t switched on yet. You can build it now; it goes live once it is."
        : `Choose a plan with the website in Billing: ${withWebsiteLine}.`;
      if (ent.ready) actions = canBuy ? <Link href="/dashboard/billing" className={inkBtn}>Choose a plan with the website</Link> : role === "admin" ? adminActions : notYours;
    }
  }

  return (
    <div className="mb-5">
      <section className={`border rounded-card shadow-elev-1 p-5 sm:p-6 ${tone} ${highlight ? "ring-2 ring-accent-500" : ""}`}>
        <h2 className="text-h2 text-ink-900">{title}</h2>
        {body && <p className="text-sm text-ink-600 mt-1">{body}</p>}
        {actions && <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>}
        {role === "admin" && !isSelf && <p className="text-xs text-ink-500 mt-3">Admin view · billing status: {ent.billingStatus}{ent.ready ? "" : " (billing columns missing)"}</p>}
        {error && <p className="text-xs text-danger-600 mt-3" role="alert">{error}</p>}
      </section>
    </div>
  );
}
