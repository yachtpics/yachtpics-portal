import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, planIncludesWebsite, planPriceWithWebsite } from "@/lib/plans";
import { brokerStripePlan, readSiteBilling } from "@/lib/websiteAddon";
import { isMissingSchema } from "@/lib/brokerSite";
import { getAccessStatus, type SubRow } from "@/lib/subscriptionAccess";
import { isPayingPlan, officeAdminRuleOn, officePlanActive } from "@/lib/brokerAccess";
import { coverSlotsForAdmin, coverSlotsTableMissing } from "@/lib/officeCoverSlots";

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
 *
 * Office admins (Nov 25 2026, OFFICE_ADMIN_PLAN_COVERS_OFFICE in
 * brokerAccess.ts, refined to SLOTS the same day — src/lib/officeCoverSlots.ts):
 * a paying office admin's plan covers as many office boats as its range,
 * her own active unsold boats first. For her, the count compared with the
 * plan's range is her own active unsold boats PLUS the slots in use — which
 * can never go past the limit, so "over" only happens when her OWN boats are
 * more than the range. When every slot is in use and office boats are still
 * waiting for one, the reminder says so and names the next plan.
 * Before migration 20261125b is applied (slots table missing) the 68a46e1
 * count is used: own + every covered broker's active unsold boats.
 * Still a reminder only.
 */
export const ENFORCE_LISTING_LIMITS = false;

export type ListingAllowance = {
  /** The broker's own Stripe plan (PLANS name), or null (no plan, trial, comped, Office-only). */
  plan: string | null;
  /** Upper end of that plan's range; null = nothing to nudge (Elite, Office, comped, trial, no Stripe plan). */
  limit: number | null;
  /**
   * The count compared with the plan's range: listings with status 'active'
   * and not sold (pocket listings included) — the broker's own, plus, for a
   * paying office admin, the covered brokers' (see `office`).
   */
  activeCount: number;
  /** The broker's own active, unsold listings. */
  ownCount: number;
  /**
   * Set when this broker is a paying office admin whose plan covers office
   * boats. mode "slots": activeCount = ownCount + slotsInUse (never above
   * the limit); `waiting` = office boats with no slot yet. mode "all" (slots
   * table missing, 68a46e1): activeCount = ownCount + brokersCount.
   */
  office: {
    name: string | null;
    mode: "slots" | "all";
    slotsInUse: number;
    slotBoats: string[];
    ownBoats: string[];
    waiting: number;
    /** Every slot in use and boats still waiting (mode "slots"). */
    full: boolean;
    brokersCount: number;
    coveredBrokers: number;
  } | null;
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

/** Active, unsold listings across several brokers (one query). */
async function countActiveMany(svc: SupabaseClient, brokerIds: string[]): Promise<number> {
  if (brokerIds.length === 0) return 0;
  const base = () => svc.from("listings").select("id", { count: "exact", head: true }).in("broker_id", brokerIds).eq("status", "active");
  let res = await base().is("sold_at", null);
  if (res.error && isMissingSchema(res.error)) res = await base();
  return res.count ?? 0;
}

/**
 * For a paying office admin: the brokers in their office their plan is
 * covering (no own plan, no Office plan) and those brokers' active unsold
 * boats. Null when the broker isn't a paying office admin, the office has an
 * Office plan, or the rule is off.
 */
export async function officeCoverageForAdmin(
  svc: SupabaseClient,
  adminId: string
): Promise<{ name: string | null; brokersCount: number; coveredBrokerIds: string[] } | null> {
  if (!officeAdminRuleOn()) return null;
  const { data: me } = await svc.from("profiles").select("brokerage_id, is_brokerage_admin").eq("id", adminId).maybeSingle();
  if (!me?.is_brokerage_admin || !me.brokerage_id) return null;
  const [{ data: mySub }, { data: office }, { data: members }] = await Promise.all([
    svc.from("subscriptions").select("status, stripe_subscription_id, trial_ends_at").eq("broker_id", adminId).maybeSingle(),
    svc.from("brokerages").select("name, subscription_status").eq("id", me.brokerage_id).maybeSingle(),
    svc.from("profiles").select("id").eq("brokerage_id", me.brokerage_id).eq("role", "broker"),
  ]);
  if (!isPayingPlan(mySub as SubRow | null)) return null;
  if (officePlanActive((office as { subscription_status: string | null } | null) ?? null)) return null;
  const otherIds = ((members ?? []) as { id: string }[]).map((m) => m.id).filter((id) => id !== adminId);
  let coveredBrokerIds: string[] = [];
  if (otherIds.length > 0) {
    const { data: subs } = await svc.from("subscriptions").select("broker_id, status, stripe_subscription_id, trial_ends_at").in("broker_id", otherIds);
    const ownPlan = new Set(
      ((subs ?? []) as (SubRow & { broker_id: string })[]).filter((s) => getAccessStatus(s) === "active").map((s) => s.broker_id)
    );
    coveredBrokerIds = otherIds.filter((id) => !ownPlan.has(id));
  }
  const brokersCount = await countActiveMany(svc, coveredBrokerIds);
  return { name: (office as { name?: string | null } | null)?.name ?? null, brokersCount, coveredBrokerIds };
}

export async function listingAllowance(svc: SupabaseClient, brokerId: string): Promise<ListingAllowance> {
  const [stripePlan, ownCount, billing, slots] = await Promise.all([
    brokerStripePlan(svc, brokerId),
    countActive(svc, brokerId),
    readSiteBilling(svc, brokerId),
    coverSlotsForAdmin(svc, brokerId).catch(() => null),
  ]);
  let office: ListingAllowance["office"] = null;
  if (slots) {
    office = {
      name: slots.officeName,
      mode: "slots",
      slotsInUse: slots.slots.length,
      slotBoats: slots.slots.map((x) => x.name),
      ownBoats: slots.ownBoats.map((x) => x.name),
      waiting: slots.waiting,
      full: slots.limit != null && slots.used >= slots.limit && slots.waiting > 0,
      brokersCount: 0,
      coveredBrokers: 0,
    };
  } else if (coverSlotsTableMissing()) {
    // Migration 20261125b not applied yet: the 68a46e1 office count.
    const legacy = await officeCoverageForAdmin(svc, brokerId).catch(() => null);
    if (legacy && legacy.coveredBrokerIds.length > 0) {
      office = {
        name: legacy.name, mode: "all", slotsInUse: 0, slotBoats: [], ownBoats: [], waiting: 0, full: false,
        brokersCount: legacy.brokersCount, coveredBrokers: legacy.coveredBrokerIds.length,
      };
    }
  }
  const activeCount = ownCount + (office ? (office.mode === "slots" ? office.slotsInUse : office.brokersCount) : 0);
  const ownIndex = stripePlan ? PLANS.findIndex((p) => p.priceId === stripePlan.priceId) : -1;
  const own = ownIndex >= 0 ? PLANS[ownIndex] : null;
  const hasWebsite = !!billing.row?.website_item_id && (billing.row.billing_status === "active" || billing.row.billing_status === "past_due");
  const limit = own ? own.maxListings : null;
  const over = limit != null && activeCount > limit;

  // The plan that fits the count; when the slots are full with boats still
  // waiting, the next plan up from hers.
  const fit = office?.full && !over && own
    ? PLANS[ownIndex + 1] ?? null
    : PLANS.find((p) => p.maxListings == null || activeCount <= p.maxListings) ?? null;
  const suggestedPlan = fit ? { id: fit.id, name: fit.name, price: fit.price, priceId: fit.priceId, range: rangeLabel(fit) } : null;
  const suggestedTotalMonthly = fit ? (hasWebsite || planIncludesWebsite(fit.name) ? planPriceWithWebsite(fit) : fit.price) : null;

  return { plan: own?.name ?? null, limit, activeCount, ownCount, office, over, suggestedPlan, suggestedTotalMonthly, hasWebsite };
}

/**
 * "You have 8 active boats. Starter covers up to 5. Growth covers 6–10 boats — $99/mo."
 * A paying office admin whose slots are all in use with office boats waiting:
 * "Your Starter plan covers 5 boats, and all 5 are in use. Growth covers 6–10 boats — $49/mo."
 * (Her assistant: "Kelly's Starter plan covers …")
 */
export function allowanceMessage(a: ListingAllowance, who?: string | null): string | null {
  if (!a.plan || a.limit == null || !a.suggestedPlan || a.suggestedTotalMonthly == null) return null;
  const next = `${a.suggestedPlan.name} covers ${a.suggestedPlan.range} — $${a.suggestedTotalMonthly}/mo.`;
  if (!a.over && a.office?.mode === "slots" && a.office.full) {
    const n = a.limit;
    return `${who ? `${who}'s` : "Your"} ${a.plan} plan covers ${n} boat${n === 1 ? "" : "s"}, and ${n === 1 ? "it is" : `all ${n} are`} in use. ${next}`;
  }
  if (!a.over) return null;
  const tail = `${a.plan} covers up to ${a.limit}. ${next}`;
  if (a.office?.mode === "all") {
    const where = a.office.name ? a.office.name : who ? "their office" : "your office";
    const split = who
      ? `${a.ownCount} theirs, ${a.office.brokersCount} their brokers'`
      : `${a.ownCount} yours, ${a.office.brokersCount} your brokers'`;
    return `${who ? `${who}'s plan is` : "Your plan is"} covering ${a.activeCount} active boat${a.activeCount === 1 ? "" : "s"} across ${where} (${split}). ${tail}`;
  }
  return `${who ? `${who} has` : "You have"} ${a.activeCount} active boats. ${tail}`;
}
