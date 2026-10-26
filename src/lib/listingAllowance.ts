import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, planIncludesWebsite, planPriceWithWebsite } from "@/lib/plans";
import { brokerStripePlan, readSiteBilling } from "@/lib/websiteAddon";
import { isMissingSchema } from "@/lib/brokerSite";

/**
 * Listing ranges per plan (Starter 1–5, Growth 6–10, Pro 11–20, Elite 21+;
 * PLANS[].minListings / maxListings in src/lib/plans.ts).
 *
 * Today this is a NUDGE only (Oct 26): the Billing page, My Listings and the
 * admin broker page say when a broker has more active boats than their plan's
 * range and suggest the plan that fits. Nothing is blocked.
 *
 * When ENFORCE_LISTING_LIMITS is switched on, the listing-creation routes are
 * meant to call listingAllowance() and refuse a new active listing when
 * `limit !== null && activeCount >= limit` — the same function, so the nudge
 * and the rule can never disagree.
 */
export const ENFORCE_LISTING_LIMITS = false;

export type ListingAllowance = {
  /** The broker's own Stripe plan (PLANS name), or null (no plan, trial, comped, Office-only). */
  plan: string | null;
  /** Upper end of that plan's range; null = nothing to nudge (Elite, Office, comped, trial, no Stripe plan). */
  limit: number | null;
  /** Listings with status 'active' and not sold (pocket listings included). */
  activeCount: number;
  over: boolean;
  /** The cheapest plan whose range covers activeCount. */
  suggestedPlan: { id: string; name: string; price: number; priceId: string; range: string } | null;
  /** Monthly total of the suggested plan, with the website line if the broker has it on their plan. */
  suggestedTotalMonthly: number | null;
  /** The broker has the $50 website line on their plan (kept when upgrading). */
  hasWebsite: boolean;
};

function rangeLabel(p: { minListings: number; maxListings: number | null }): string {
  return p.maxListings == null ? `${p.minListings}+ boats` : `${p.minListings}–${p.maxListings} boats`;
}

/** Active, unsold listings of a broker (works before listings.sold_at exists). */
async function countActive(svc: SupabaseClient, brokerId: string): Promise<number> {
  const base = () => svc.from("listings").select("id", { count: "exact", head: true }).eq("broker_id", brokerId).eq("status", "active");
  let res = await base().is("sold_at", null);
  if (res.error && isMissingSchema(res.error)) res = await base();
  return res.count ?? 0;
}

export async function listingAllowance(svc: SupabaseClient, brokerId: string): Promise<ListingAllowance> {
  const [stripePlan, activeCount, billing] = await Promise.all([
    brokerStripePlan(svc, brokerId),
    countActive(svc, brokerId),
    readSiteBilling(svc, brokerId),
  ]);
  const own = stripePlan ? PLANS.find((p) => p.priceId === stripePlan.priceId) ?? null : null;
  const hasWebsite = !!billing.row?.website_item_id && (billing.row.billing_status === "active" || billing.row.billing_status === "past_due");
  const limit = own ? own.maxListings : null;
  const over = limit != null && activeCount > limit;

  const fit = PLANS.find((p) => p.maxListings == null || activeCount <= p.maxListings) ?? null;
  const suggestedPlan = fit ? { id: fit.id, name: fit.name, price: fit.price, priceId: fit.priceId, range: rangeLabel(fit) } : null;
  const suggestedTotalMonthly = fit ? (hasWebsite || planIncludesWebsite(fit.name) ? planPriceWithWebsite(fit) : fit.price) : null;

  return { plan: own?.name ?? null, limit, activeCount, over, suggestedPlan, suggestedTotalMonthly, hasWebsite };
}

/** "You have 8 active boats. Starter covers up to 5. Growth covers 6–10 boats — $99/mo." */
export function allowanceMessage(a: ListingAllowance, who?: string | null): string | null {
  if (!a.over || !a.plan || a.limit == null || !a.suggestedPlan || a.suggestedTotalMonthly == null) return null;
  return `${who ? `${who} has` : "You have"} ${a.activeCount} active boats. ${a.plan} covers up to ${a.limit}. ${a.suggestedPlan.name} covers ${a.suggestedPlan.range} — $${a.suggestedTotalMonthly}/mo.`;
}
