import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageAdmin } from "@/lib/requireBrokerageAdmin";
import { stripe } from "@/lib/stripe";
import { OFFICE_PLAN } from "@/lib/plans";

export const runtime = "nodejs";

// Start (or resume) the Office plan subscription for the caller's brokerage.
export async function POST(req: NextRequest) {
  const auth = await requireBrokerageAdmin();
  if (auth.error) return auth.error;
  const { admin, userId, brokerageId } = auth;

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
    line_items: [{ price: OFFICE_PLAN.priceId, quantity: 1 }],
    success_url: `${origin}/dashboard/brokerage/billing?success=1`,
    cancel_url: `${origin}/dashboard/brokerage/billing?cancelled=1`,
    subscription_data: {
      trial_period_days: trialDays,
      metadata: { brokerage_id: brokerageId },
    },
    metadata: { brokerage_id: brokerageId },
  });

  return NextResponse.json({ url: session.url });
}
