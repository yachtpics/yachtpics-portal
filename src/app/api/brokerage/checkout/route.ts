import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageAdmin } from "@/lib/requireBrokerageAdmin";
import { stripe } from "@/lib/stripe";
import { OFFICE_PLAN, TEAM_PLAN, brokeragePlanById } from "@/lib/plans";

export const runtime = "nodejs";

// Start (or resume) the Team or Office plan subscription for the caller's
// brokerage. Body { plan?: "team" | "office" }; Office when absent or
// unreadable, so an older open page keeps working.
export async function POST(req: NextRequest) {
  const auth = await requireBrokerageAdmin();
  if (auth.error) return auth.error;
  const { admin, userId, brokerageId } = auth;

  const body = (await req.json().catch(() => ({}))) as { plan?: unknown };
  const plan = brokeragePlanById(typeof body?.plan === "string" ? body.plan : null) ?? OFFICE_PLAN;

  // Same count as the Billing page: brokers (not assistants) in this brokerage.
  if (plan.id === TEAM_PLAN.id) {
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

  const { data: brokerage } = await admin
    .from("brokerages")
    .select("name, stripe_customer_id, trial_used")
    .eq("id", brokerageId)
    .single();

  const { data: me } = await admin.from("profiles").select("display_email").eq("id", userId).single();

  // Find or create the Stripe customer for this brokerage.
  let customerId = brokerage?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: me?.display_email ?? undefined,
      name: brokerage?.name ?? "Brokerage",
      metadata: { brokerage_id: brokerageId },
    });
    customerId = customer.id;
    await admin.from("brokerages").update({ stripe_customer_id: customerId }).eq("id", brokerageId);
  }

  const origin = req.headers.get("origin") ?? "https://portal.yachtpics.com";
  const trialDays = brokerage?.trial_used ? undefined : 30;

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: plan.priceId, quantity: 1 }],
    success_url: `${origin}/dashboard/brokerage/billing?success=1`,
    cancel_url: `${origin}/dashboard/brokerage/billing?cancelled=1`,
    subscription_data: {
      trial_period_days: trialDays,
      metadata: { brokerage_id: brokerageId, plan: plan.id },
    },
    metadata: { brokerage_id: brokerageId },
  });

  return NextResponse.json({ url: session.url });
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
