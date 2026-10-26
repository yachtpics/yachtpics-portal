import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { PLANS, WEBSITE_PRICE, planIncludesWebsite, planForPriceId } from "@/lib/plans";
import {
  ensureWebsitePrice,
  planItemOf,
  readSiteBilling,
  revalidateSite,
  subscriptionPeriodEnd,
  syncWebsiteFromPlanSubscription,
  websiteItemOf,
} from "@/lib/websiteAddon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/change-plan { priceId | planKey, withWebsite? } → { ok, total }
 *
 * Changes the tier on the broker's EXISTING plan subscription (Oct 26) —
 * never a new Checkout, so nobody ends up with two subscriptions. Self-only,
 * like the other billing routes. Office is out of scope.
 *
 *  - The plan item's price is swapped (proration_behavior "create_prorations").
 *  - withWebsite: true → the $50 website item is added if absent.
 *    withWebsite: false → the website item is removed (no proration;
 *    website_ends_at = period end, so the site stays live until then).
 *    Omitted → the website item is left as it is.
 *  - To Elite: Elite includes the website, so the $50 line is removed (no
 *    proration) and the site stays live as Elite.
 *  - From Elite to a lower tier without "with website": a broker with a site
 *    keeps it live until the period end (website_ends_at), then it's offline.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { priceId?: unknown; planKey?: unknown; withWebsite?: unknown };
  const target = PLANS.find((p) => p.priceId === body.priceId || p.id === body.planKey);
  if (!target) return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  const withWebsite = body.withWebsite === true ? true : body.withWebsite === false ? false : undefined;

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: row } = await svc.from("subscriptions").select("stripe_subscription_id").eq("broker_id", user.id).maybeSingle();
  const subscriptionId = row?.stripe_subscription_id as string | undefined;
  if (!subscriptionId) return NextResponse.json({ error: "You don't have a plan yet — choose one to subscribe.", needsCheckout: true }, { status: 409 });

  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (!["active", "trialing", "past_due"].includes(sub.status)) {
      return NextResponse.json({ error: "Your plan isn't active — choose one to subscribe.", needsCheckout: true }, { status: 409 });
    }
    if (sub.metadata?.brokerage_id) return NextResponse.json({ error: "Office plans are changed from the Brokerage page." }, { status: 400 });
    const planItem = planItemOf(sub);
    if (!planItem) return NextResponse.json({ error: "We couldn't find your plan on the subscription." }, { status: 500 });
    const websiteItem = websiteItemOf(sub);
    const fromPlan = planForPriceId(planItem.price.id);
    const fromElite = planIncludesWebsite(fromPlan?.name);
    const toElite = planIncludesWebsite(target.name);
    const samePlan = planItem.price.id === target.priceId;

    const wantWebsite = toElite ? false : withWebsite === undefined ? !!websiteItem : withWebsite;
    if (samePlan && wantWebsite === !!websiteItem) {
      return NextResponse.json({ error: "That's already your plan." }, { status: 400 });
    }

    const periodEnd = subscriptionPeriodEnd(sub);
    const billing = await readSiteBilling(svc, user.id);
    const hasSite = billing.ready && !!billing.row;
    const paidThrough = !!billing.row?.website_ends_at && Date.parse(billing.row.website_ends_at) > Date.now();

    // 1) The $50 line comes off (to Elite, or "without website"): no proration;
    //    the site stays live until the period end (or as Elite).
    if (websiteItem && !wantWebsite) {
      if (hasSite && periodEnd) {
        await svc.from("broker_sites").update({ website_ends_at: periodEnd, updated_at: new Date().toISOString() }).eq("broker_id", user.id);
      }
      await stripe.subscriptionItems.del(websiteItem.id, { proration_behavior: "none" });
    }
    // From Elite to a lower tier without the website: the site (if any) runs to the period end.
    if (fromElite && !toElite && !wantWebsite && hasSite && periodEnd) {
      await svc.from("broker_sites").update({ website_ends_at: periodEnd, updated_at: new Date().toISOString() }).eq("broker_id", user.id);
    }

    // 2) The plan item's price, plus the website line when it's being added.
    const items: Stripe.SubscriptionUpdateParams.Item[] = [];
    if (!samePlan) items.push({ id: planItem.id, price: target.priceId });
    let addWebsiteSeparately = false;
    if (wantWebsite && !websiteItem) {
      // Re-adding inside a month already paid for → no proration for the website line.
      if (paidThrough) addWebsiteSeparately = true;
      else items.push({ price: await ensureWebsitePrice(), quantity: 1 });
    }
    if (items.length) {
      await stripe.subscriptions.update(subscriptionId, { items, proration_behavior: "create_prorations" });
    }
    if (addWebsiteSeparately) {
      await stripe.subscriptionItems.create({ subscription: subscriptionId, price: await ensureWebsitePrice(), quantity: 1, proration_behavior: "none" });
    }

    // 3) Record it now (the webhook does the same moments later).
    const fresh = await stripe.subscriptions.retrieve(subscriptionId);
    const newPlanPrice = planItemOf(fresh)?.price.id ?? target.priceId;
    await svc.from("subscriptions").update({ stripe_price_id: newPlanPrice, status: fresh.status }).eq("broker_id", user.id);
    await syncWebsiteFromPlanSubscription(svc, fresh, user.id);
    revalidateSite(billing.row?.slug);

    const total = target.price + (wantWebsite ? WEBSITE_PRICE : 0);
    return NextResponse.json({ ok: true, total });
  } catch (e) {
    console.error("[billing] change-plan failed:", e);
    return NextResponse.json({ error: "We couldn't change your plan just now. Please try again in a moment." }, { status: 500 });
  }
}
