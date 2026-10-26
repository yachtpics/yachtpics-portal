import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { stripe } from "@/lib/stripe";
import { PLANS, WEBSITE_PRICE, isPlanPriceId, planForPriceId, planIncludesWebsite } from "@/lib/plans";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { hasAccess, isStripePaid } from "@/lib/subscriptionAccess";
import { normaliseSlug, slugProblem, suggestSlug } from "@/lib/brokerSite";

/**
 * Broker Website billing (owner decision, Oct 26 2026) — SERVER ONLY.
 *
 * The website is a SECOND LINE ITEM ($50/month) on the broker's own Portal
 * plan subscription: Starter $29 → $79, Growth $49 → $99, Pro $79 → $129;
 * Elite $149 includes it. One Stripe price (lookup_key website_monthly_50).
 *
 * A site at /b/{slug} is LIVE when
 *   (a) the broker has Portal access (getEffectiveAccessStatus + hasAccess), AND
 *   (b) one of:
 *       - their own Stripe plan is Elite;
 *       - their plan subscription carries the website item (website_item_id)
 *         and the subscription is active / trialing / past_due;
 *       - they removed the website but website_ends_at (the end of the month
 *         already paid for) is still in the future and the plan is alive;
 *       - an admin comped it (billing_status 'comped').
 * Office-plan coverage alone doesn't include it.
 *
 * Columns on broker_sites (migration 20261026b): website_item_id,
 * stripe_subscription_id, billing_status (mirrors the PLAN subscription, or
 * 'comped'), current_period_end, website_ends_at. The Stripe webhook writes
 * them from every plan-subscription event (syncWebsiteFromPlanSubscription);
 * /api/website/add and /api/website/remove change the item and sync at once.
 *
 * REMOVAL AT PERIOD END: Stripe can't schedule an item's removal for the
 * period end, so "Remove website" sets website_ends_at = current_period_end
 * FIRST, then deletes the item straight away with proration_behavior "none"
 * (no credit, no charge — the current month is already paid). Nothing renews,
 * there is no cron to miss, and the site stays live until website_ends_at.
 * Re-adding before then adds the item back with no proration (that month is
 * paid) and clears website_ends_at.
 *
 * Before 20261026b is applied the columns are missing: only Elite counts.
 */

export const WEBSITE_LOOKUP_KEY = "website_monthly_50";
export const WEBSITE_PRICE_KIND = "website";

export type WebsiteBillingStatus = "none" | "active" | "past_due" | "canceled" | "comped";
export type WebsiteReason = "elite" | "website" | "comped" | "no_plan" | "no_website";

export type SiteBillingRow = {
  slug: string;
  website_item_id: string | null;
  stripe_subscription_id: string | null;
  billing_status: WebsiteBillingStatus;
  current_period_end: string | null;
  website_ends_at: string | null;
};

const BILLING_COLS = "slug, website_item_id, stripe_subscription_id, billing_status, current_period_end, website_ends_at";

/** The broker's site billing. `ready` = the 20261026b columns exist. */
export async function readSiteBilling(svc: SupabaseClient, brokerId: string): Promise<{ ready: boolean; row: SiteBillingRow | null }> {
  try {
    const { data, error } = await svc.from("broker_sites").select(BILLING_COLS).eq("broker_id", brokerId).maybeSingle();
    if (error) return { ready: false, row: null };
    return { ready: true, row: (data as SiteBillingRow | null) ?? null };
  } catch {
    return { ready: false, row: null };
  }
}

/** The broker's own Stripe plan, if one is attached and live (active / trialing). */
export async function brokerStripePlan(svc: SupabaseClient, brokerId: string): Promise<{
  subscriptionId: string; priceId: string | null; planName: string | null; planPrice: number | null; status: string | null;
} | null> {
  try {
    const { data: sub } = await svc
      .from("subscriptions")
      .select("status, stripe_subscription_id, stripe_price_id, trial_ends_at")
      .eq("broker_id", brokerId)
      .maybeSingle();
    if (!sub?.stripe_subscription_id) return null;
    const live = isStripePaid(sub) || sub.status === "past_due";
    if (!live) return null;
    const plan = planForPriceId(sub.stripe_price_id as string | null);
    return {
      subscriptionId: sub.stripe_subscription_id as string,
      priceId: (sub.stripe_price_id as string | null) ?? null,
      planName: plan?.name ?? null,
      planPrice: plan?.price ?? null,
      status: (sub.status as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

export type WebsiteEntitlement = {
  live: boolean;
  reason: WebsiteReason;
  /** Billing columns exist (migration 20261026b applied). */
  ready: boolean;
  /** Portal access as today (plan, trial, Office, paid Reel Service boat). */
  portalAccess: boolean;
  /** The broker's own Stripe plan includes the website (Elite). */
  elite: boolean;
  billingStatus: WebsiteBillingStatus;
  /** The website item is on the plan subscription right now. */
  onPlan: boolean;
  /** Removed: live until this time (end of the month paid for). */
  endsAt: string | null;
  currentPeriodEnd: string | null;
  /** The broker's own Stripe plan (PLANS name), if any — "Growth". Null for comped / trial / Office-only. */
  planName: string | null;
  planPrice: number | null;
  /** A live own Stripe plan subscription the website item can be added to. */
  canAddToPlan: boolean;
};

/** THE rule for whether a broker's website is live. Used by /b/[slug], the lead form, the editor and the admin card. */
export async function websiteEntitlement(svc: SupabaseClient, brokerId: string): Promise<WebsiteEntitlement> {
  const [access, plan, billing] = await Promise.all([
    getEffectiveAccessStatus(svc, brokerId).catch(() => null),
    brokerStripePlan(svc, brokerId),
    readSiteBilling(svc, brokerId),
  ]);
  const portalAccess = !!access && hasAccess(access.status);
  const elite = !!plan && planIncludesWebsite(plan.planName);
  const row = billing.row;
  const billingStatus: WebsiteBillingStatus = (row?.billing_status as WebsiteBillingStatus) ?? "none";
  const planAlive = billingStatus === "active" || billingStatus === "past_due";
  const onPlan = !!row?.website_item_id && planAlive;
  const endsAt = row?.website_ends_at ?? null;
  const paidThrough = !!endsAt && Date.parse(endsAt) > Date.now() && planAlive;
  const isPlan = !!plan && PLANS.some((p) => p.priceId === plan.priceId);
  const base = {
    ready: billing.ready,
    portalAccess,
    elite,
    billingStatus,
    onPlan,
    endsAt: onPlan ? null : paidThrough ? endsAt : null,
    currentPeriodEnd: row?.current_period_end ?? null,
    planName: isPlan ? plan!.planName : null,
    planPrice: isPlan ? plan!.planPrice : null,
    canAddToPlan: isPlan && !elite && billing.ready,
  };
  if (!portalAccess) return { ...base, live: false, reason: "no_plan" };
  if (elite) return { ...base, live: true, reason: "elite" };
  if (billingStatus === "comped") return { ...base, live: true, reason: "comped" };
  if (onPlan || paidThrough) return { ...base, live: true, reason: "website" };
  return { ...base, live: false, reason: "no_website" };
}

// ── The Stripe price ─────────────────────────────────────────────────────────

let cachedPriceId: string | null = null;

/** The recurring $50/month website price: STRIPE_WEBSITE_PRICE_ID, else by lookup_key, else created once. */
export async function ensureWebsitePrice(): Promise<string> {
  const fromEnv = process.env.STRIPE_WEBSITE_PRICE_ID;
  if (fromEnv) return fromEnv;
  if (cachedPriceId) return cachedPriceId;
  const found = await stripe.prices.list({ lookup_keys: [WEBSITE_LOOKUP_KEY], active: true, limit: 1 });
  if (found.data[0]) {
    cachedPriceId = found.data[0].id;
    return cachedPriceId;
  }
  const product = await stripe.products.create({
    name: "YachtPics Portal Website",
    description: "Your own website at portal.yachtpics.com/b/…, filled from your Portal listings",
    metadata: { kind: WEBSITE_PRICE_KIND },
  });
  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: WEBSITE_PRICE * 100,
    recurring: { interval: "month" },
    lookup_key: WEBSITE_LOOKUP_KEY,
    tax_behavior: "exclusive",
    nickname: "Website — monthly",
    metadata: { kind: WEBSITE_PRICE_KIND },
  });
  cachedPriceId = price.id;
  return cachedPriceId;
}

/** Is this Stripe price the website line? (No API call: env id, cached id, lookup_key or metadata.) */
export function isWebsitePrice(price: Stripe.Price | string | null | undefined): boolean {
  if (!price) return false;
  const id = typeof price === "string" ? price : price.id;
  if (process.env.STRIPE_WEBSITE_PRICE_ID && id === process.env.STRIPE_WEBSITE_PRICE_ID) return true;
  if (cachedPriceId && id === cachedPriceId) return true;
  if (typeof price === "string") return false;
  return price.lookup_key === WEBSITE_LOOKUP_KEY || price.metadata?.kind === WEBSITE_PRICE_KIND;
}

/**
 * The PLAN item of a (possibly multi-item) subscription: the item whose price
 * is one of PLANS / the Office plan; else the first item that isn't the
 * website line. Never read items[0] blindly — a broker with the website has
 * two items, in either order.
 */
export function planItemOf(subscription: Stripe.Subscription): Stripe.SubscriptionItem | null {
  const items = subscription.items?.data ?? [];
  return items.find((i) => isPlanPriceId(i.price?.id)) ?? items.find((i) => !isWebsitePrice(i.price)) ?? null;
}

/** The website item of a plan subscription, if it carries one. */
export function websiteItemOf(subscription: Stripe.Subscription): Stripe.SubscriptionItem | null {
  return (subscription.items?.data ?? []).find((i) => isWebsitePrice(i.price)) ?? null;
}

/** Period end of a subscription (top level on older API versions, per item on newer). */
export function subscriptionPeriodEnd(subscription: Stripe.Subscription): string | null {
  const plan = planItemOf(subscription) as unknown as { current_period_end?: number } | null;
  const raw = (subscription as unknown as { current_period_end?: number }).current_period_end ?? plan?.current_period_end ?? null;
  return raw ? new Date(raw * 1000).toISOString() : null;
}

// ── The site row ─────────────────────────────────────────────────────────────

/**
 * The broker's site slug, creating the row (unpublished, address from their
 * name; "-2", "-3"… if taken) when there is none. Null if it can't be made.
 */
export async function ensureSiteRow(svc: SupabaseClient, brokerId: string): Promise<string | null> {
  const { data: existing } = await svc.from("broker_sites").select("slug").eq("broker_id", brokerId).maybeSingle();
  if (existing?.slug) return existing.slug as string;
  const { data: p } = await svc.from("profiles").select("first_name, last_name").eq("id", brokerId).maybeSingle();
  let base = suggestSlug(p?.first_name, p?.last_name);
  if (!base || slugProblem(base)) base = normaliseSlug(`broker-${brokerId.slice(0, 8)}`);
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base.slice(0, 55)}-${i + 1}`;
    const { error } = await svc.from("broker_sites").insert({ broker_id: brokerId, slug });
    if (!error) return slug;
    if (/broker_sites_pkey|broker_id/.test(error.message)) {
      const { data: again } = await svc.from("broker_sites").select("slug").eq("broker_id", brokerId).maybeSingle();
      return (again?.slug as string | undefined) ?? null;
    }
    if (!/duplicate|unique/i.test(error.message)) return null;
  }
  return null;
}

export function revalidateSite(slug: string | null | undefined) {
  if (!slug) return;
  try { revalidatePath(`/b/${slug}`); } catch { /* outside a request: fine */ }
}

// ── Sync from the PLAN subscription (webhook + add/remove routes) ────────────

function mirrorStatus(status: Stripe.Subscription.Status): WebsiteBillingStatus | null {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
    case "paused":
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null; // incomplete: nothing to record yet
  }
}

/**
 * Record on broker_sites whether the broker's plan subscription carries the
 * website item, and mirror its status / period. Idempotent.
 *
 *  - Website item present → website_item_id set, website_ends_at cleared,
 *    billing_status mirrors the subscription (creates the site row if needed).
 *  - No item → website_item_id null; website_ends_at is kept (a removal paid
 *    through the month); a comp ('comped') is kept as is.
 *  - An event for a different (older) plan subscription never overwrites a
 *    row tied to the broker's current live one.
 *  - No row and no website item → nothing to do.
 */
export async function syncWebsiteFromPlanSubscription(
  svc: SupabaseClient,
  subscription: Stripe.Subscription,
  brokerId: string,
  opts: { deleted?: boolean } = {},
): Promise<void> {
  const billing = await readSiteBilling(svc, brokerId);
  if (!billing.ready) return; // 20261026b not applied
  const row = billing.row;
  const item = opts.deleted ? null : websiteItemOf(subscription);
  const status = opts.deleted ? "canceled" : mirrorStatus(subscription.status);
  if (!status) return;

  if (row?.stripe_subscription_id && row.stripe_subscription_id !== subscription.id) {
    const rowLive = row.billing_status === "active" || row.billing_status === "past_due";
    const eventLive = status === "active" || status === "past_due";
    if (rowLive && !item) return; // about an older subscription
    if (!eventLive) return;
  }
  if (!row && !item) return;

  const slug = row?.slug ?? (await ensureSiteRow(svc, brokerId));
  if (!slug) return;

  const update: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
    current_period_end: subscriptionPeriodEnd(subscription),
    website_item_id: item?.id ?? null,
    updated_at: new Date().toISOString(),
  };
  if (item) {
    update.website_ends_at = null;
    update.billing_status = status;
  } else if (row?.billing_status !== "comped") {
    update.billing_status = row?.website_item_id || row?.website_ends_at || row?.stripe_subscription_id ? status : "none";
  }
  const { error } = await svc.from("broker_sites").update(update).eq("broker_id", brokerId);
  if (error) {
    console.warn(`[website] couldn't sync ${subscription.id} for ${brokerId}: ${error.message}`);
    return;
  }
  revalidateSite(slug);
}
