import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { BROKERAGE_PLANS, OFFICE_PLAN, brokeragePlanForPriceId, type BrokeragePlan } from "@/lib/plans";

/**
 * Which brokerage plan (Team or Office) a subscription is on — Nov 25 2026.
 *
 * There is no plan column on `brokerages`; the plan lives on the Stripe
 * subscription item. This costs one Stripe call, so it is used ONLY on the
 * brokerage Billing page and the brokerage change-plan route — never on the
 * dashboard or any hot path. Call it only when a subscription id exists.
 *
 * On any error or an unknown price it answers Office (the only brokerage plan
 * before Nov 25) with itemId null.
 */
export async function currentBrokeragePlan(
  stripeSubscriptionId: string
): Promise<{ plan: BrokeragePlan; itemId: string | null; subscription: Stripe.Subscription | null }> {
  try {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const found = brokeragePlanItemOf(sub);
    if (found) return { plan: found.plan, itemId: found.item.id, subscription: sub };
    return { plan: OFFICE_PLAN, itemId: null, subscription: sub };
  } catch (e) {
    console.warn(`[brokerage-plan] lookup failed: ${e instanceof Error ? e.message : String(e)}`);
    return { plan: OFFICE_PLAN, itemId: null, subscription: null };
  }
}

/** The subscription item whose price is one of BROKERAGE_PLANS, with its plan. No Stripe call. */
export function brokeragePlanItemOf(
  sub: Stripe.Subscription
): { plan: BrokeragePlan; item: Stripe.SubscriptionItem } | null {
  const items = sub.items?.data ?? [];
  for (let i = 0; i < items.length; i++) {
    const plan = brokeragePlanForPriceId(items[i].price?.id);
    if (plan && BROKERAGE_PLANS.indexOf(plan) >= 0) return { plan, item: items[i] };
  }
  return null;
}
