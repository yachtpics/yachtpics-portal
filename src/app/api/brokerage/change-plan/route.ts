import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageAdmin } from "@/lib/requireBrokerageAdmin";
import { stripe } from "@/lib/stripe";
import { TEAM_PLAN, brokeragePlanById } from "@/lib/plans";
import { brokeragePlanItemOf } from "@/lib/brokeragePlanServer";
import { demoGuardFromSession } from "@/lib/demoServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/brokerage/change-plan { plan: "team" | "office" } → { ok, plan } | { ok, unchanged }
 *
 * Moves the caller's brokerage between Team and Office (Nov 25 2026) on its
 * EXISTING subscription — never a new Checkout. Mirrors the broker
 * change-plan route (src/app/api/stripe/change-plan/route.ts): the plan
 * item's price is swapped with proration_behavior "create_prorations", so
 * Stripe puts a credit / charge for the rest of the period on the next
 * invoice. During a trial there is nothing to prorate; the new price simply
 * applies when the trial ends. The webhook (customer.subscription.updated)
 * keeps `brokerages` in step; this route also records status and period now.
 */
export async function POST(req: NextRequest) {
  const auth = await requireBrokerageAdmin();
  if (auth.error) return auth.error;
  // Read-only demo (layer 3 — src/lib/demo.ts). requireBrokerageAdmin doesn't
  // hand back the user, so this reads it from the session.
  { const demo = await demoGuardFromSession(); if (demo) return demo; }
  const { admin, brokerageId } = auth;

  const body = (await req.json().catch(() => ({}))) as { plan?: unknown };
  const target = brokeragePlanById(typeof body?.plan === "string" ? body.plan : null);
  if (!target) return NextResponse.json({ error: "Unknown plan." }, { status: 400 });

  const { data: brokerage } = await admin
    .from("brokerages")
    .select("stripe_subscription_id, subscription_status")
    .eq("id", brokerageId)
    .single();
  const subscriptionId = (brokerage?.stripe_subscription_id as string | null) ?? null;
  const dbStatus = (brokerage?.subscription_status as string | null) ?? null;
  if (!subscriptionId || (dbStatus !== "active" && dbStatus !== "trialing")) {
    return NextResponse.json({ error: "Start a plan first." }, { status: 400 });
  }

  // Same count as the Billing page: brokers (not assistants) in this brokerage.
  if (target.id === TEAM_PLAN.id) {
    const { count } = await admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("brokerage_id", brokerageId)
      .eq("role", "broker");
    const brokers = count ?? 0;
    if (brokers > TEAM_PLAN.brokerCap) {
      return NextResponse.json(
        { error: `Team covers up to ${TEAM_PLAN.brokerCap} brokers. Your office has ${brokers}, so the Office plan is the one that fits.` },
        { status: 400 }
      );
    }
  }

  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (sub.status !== "active" && sub.status !== "trialing") {
      return NextResponse.json({ error: "Start a plan first." }, { status: 400 });
    }
    if (sub.metadata?.brokerage_id !== brokerageId) {
      return NextResponse.json({ error: "We couldn't find your office plan." }, { status: 400 });
    }
    const current = brokeragePlanItemOf(sub);
    if (!current) {
      return NextResponse.json({ error: "We couldn't find your plan on the subscription." }, { status: 500 });
    }
    if (current.plan.id === target.id) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    const updated = await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: current.item.id, price: target.priceId }],
      proration_behavior: "create_prorations",
      metadata: { ...(sub.metadata ?? {}), brokerage_id: brokerageId, plan: target.id },
    });

    // Record it now (the webhook does the same moments later).
    const rawEnd = (updated as unknown as { current_period_end?: number }).current_period_end
      ?? (updated.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end
      ?? null;
    const patch: Record<string, string> = { subscription_status: updated.status };
    if (rawEnd) patch.current_period_end = new Date(rawEnd * 1000).toISOString();
    await admin.from("brokerages").update(patch).eq("id", brokerageId);

    return NextResponse.json({ ok: true, plan: target.id });
  } catch (e) {
    console.error("[brokerage] change-plan failed:", e);
    return NextResponse.json({ error: "We couldn't change your plan just now. Please try again in a moment." }, { status: 500 });
  }
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
