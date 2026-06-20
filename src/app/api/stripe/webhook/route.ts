import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) return NextResponse.json({ error: "No signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Use service role to bypass RLS
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  function periodEndIso(subscription: Stripe.Subscription): string | null {
    const raw = (subscription as any).current_period_end
      ?? (subscription as any).items?.data?.[0]?.current_period_end
      ?? null;
    return raw ? new Date(raw * 1000).toISOString() : null;
  }

  async function upsertSubscription(subscription: Stripe.Subscription) {
    // Office (brokerage) subscription? Route it to the brokerages table instead.
    const brokerageId = subscription.metadata?.brokerage_id;
    if (brokerageId) {
      await supabase.from("brokerages").update({
        stripe_subscription_id: subscription.id,
        subscription_status: subscription.status,
        current_period_end: periodEndIso(subscription),
        trial_used: true,
      }).eq("id", brokerageId);
      return;
    }

    let userId = subscription.metadata?.supabase_user_id;

    // Fallback: look up broker by stripe_customer_id if metadata is missing
    if (!userId && subscription.customer) {
      const { data } = await supabase
        .from("subscriptions")
        .select("broker_id")
        .eq("stripe_customer_id", subscription.customer as string)
        .single();
      userId = data?.broker_id;
    }

    if (!userId) return;

    const priceId = subscription.items.data[0]?.price.id;
    const status = subscription.status; // active, trialing, past_due, canceled, etc.
    // current_period_end moved to items in newer Stripe API versions — handle both
    const periodEndRaw = (subscription as any).current_period_end
      ?? (subscription as any).items?.data?.[0]?.current_period_end
      ?? null;
    const periodEnd = periodEndRaw ? new Date(periodEndRaw * 1000).toISOString() : null;

    await supabase.from("subscriptions")
      .update({
        stripe_subscription_id: subscription.id,
        stripe_price_id: priceId,
        status,
        current_period_end: periodEnd,
      })
      .eq("broker_id", userId);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        await upsertSubscription(subscription);
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.created": {
      await upsertSubscription(event.data.object as Stripe.Subscription);
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const brokerageId = subscription.metadata?.brokerage_id;
      if (brokerageId) {
        await supabase.from("brokerages").update({
          subscription_status: "canceled",
          stripe_subscription_id: null,
        }).eq("id", brokerageId);
        break;
      }
      let userId = subscription.metadata?.supabase_user_id;
      if (!userId && subscription.customer) {
        const { data } = await supabase.from("subscriptions").select("broker_id").eq("stripe_customer_id", subscription.customer as string).single();
        userId = data?.broker_id;
      }
      if (userId) {
        await supabase.from("subscriptions").update({
          status: "canceled",
          stripe_subscription_id: null,
          stripe_price_id: null,
        }).eq("broker_id", userId);
      }
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
        await upsertSubscription(subscription);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
