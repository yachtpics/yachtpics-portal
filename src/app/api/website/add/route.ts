import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { resolveActingBroker, serviceClient } from "@/lib/brokerSiteServer";
import {
  ensureSiteRow,
  ensureWebsitePrice,
  readSiteBilling,
  syncWebsiteFromPlanSubscription,
  websiteEntitlement,
  websiteItemOf,
} from "@/lib/websiteAddon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/website/add → { ok }
 *
 * Adds the $50/month website line to the broker's EXISTING Portal plan
 * subscription (Oct 26 — Starter $79, Growth $99, Pro $129 with the website).
 * Billing changes are the broker's own, like the plan checkout and billing
 * portal routes (signed-in broker only — not an assistant, never an admin for
 * someone else).
 *
 * Refused: Elite (included), comped, already on, no own Stripe plan (comped
 * account, in-app trial without a subscription, Office-only coverage) — those
 * choose "plan + website" in Billing instead (needsPlan: true).
 *
 * Proration: normally create_prorations (the rest of this month is charged
 * on the next invoice). If the broker removed the website and is re-adding
 * it before website_ends_at, that month is already paid → no proration.
 */
export async function POST(req: NextRequest) {
  const who = await resolveActingBroker(req.nextUrl.searchParams.get("brokerId"));
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  if (!(who.role === "broker" && who.brokerId === who.userId)) {
    return NextResponse.json({ error: "Only the broker can change their plan. They can add the website from their own Website or Billing page." }, { status: 403 });
  }
  const svc = serviceClient();
  const brokerId = who.brokerId;
  const ent = await websiteEntitlement(svc, brokerId);
  if (!ent.ready) return NextResponse.json({ error: "Adding the website isn’t switched on yet." }, { status: 503 });
  if (ent.elite) return NextResponse.json({ error: "Your website is included with Elite." }, { status: 409 });
  if (ent.billingStatus === "comped") return NextResponse.json({ error: "Your website is already on, at no charge." }, { status: 409 });
  if (ent.onPlan) return NextResponse.json({ error: "The website is already on your plan." }, { status: 409 });
  if (!ent.canAddToPlan) {
    return NextResponse.json({ error: "Choose a plan with the website in Billing.", needsPlan: true }, { status: 400 });
  }

  const { data: sub } = await svc.from("subscriptions").select("stripe_subscription_id").eq("broker_id", brokerId).maybeSingle();
  const subscriptionId = sub?.stripe_subscription_id as string | undefined;
  if (!subscriptionId) return NextResponse.json({ error: "Choose a plan with the website in Billing.", needsPlan: true }, { status: 400 });

  try {
    await ensureSiteRow(svc, brokerId);
    const [priceId, current, billing] = await Promise.all([
      ensureWebsitePrice(),
      stripe.subscriptions.retrieve(subscriptionId),
      readSiteBilling(svc, brokerId),
    ]);
    if (!["active", "trialing", "past_due"].includes(current.status)) {
      return NextResponse.json({ error: "Your plan isn’t active. Choose a plan with the website in Billing.", needsPlan: true }, { status: 400 });
    }
    if (!websiteItemOf(current)) {
      const paidThrough = !!billing.row?.website_ends_at && Date.parse(billing.row.website_ends_at) > Date.now();
      await stripe.subscriptionItems.create({
        subscription: subscriptionId,
        price: priceId,
        quantity: 1,
        proration_behavior: paidThrough ? "none" : "create_prorations",
      });
    }
    const fresh = await stripe.subscriptions.retrieve(subscriptionId);
    await syncWebsiteFromPlanSubscription(svc, fresh, brokerId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[website] add failed:", e);
    return NextResponse.json({ error: "We couldn’t add the website just now. Please try again in a moment." }, { status: 500 });
  }
}
