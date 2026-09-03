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

  /**
   * Tell Charlie the moment money moves. He found out about his newest
   * subscriber days late, from a dashboard he happened to open — the win
   * should arrive as an email the minute the checkout clears, and a
   * cancellation deserves the same immediacy for the opposite reason.
   * Best-effort: a notification hiccup must never fail the webhook, or
   * Stripe would retry and double-process the event.
   */
  async function notifyCharlie(subscription: Stripe.Subscription, kind: "new" | "canceled") {
    try {
      if (!process.env.RESEND_API_KEY) return;

      // Who is this? A brokerage office plan, or an individual broker.
      let who = "A broker";
      let detail = "";
      const brokerageId = subscription.metadata?.brokerage_id;
      if (brokerageId) {
        const { data: b } = await supabase.from("brokerages").select("name").eq("id", brokerageId).maybeSingle();
        who = b?.name ? `${b.name} (office plan)` : "A brokerage (office plan)";
      } else {
        let userId = subscription.metadata?.supabase_user_id;
        if (!userId && subscription.customer) {
          const { data } = await supabase
            .from("subscriptions").select("broker_id")
            .eq("stripe_customer_id", subscription.customer as string).single();
          userId = data?.broker_id;
        }
        if (userId) {
          const { data: p } = await supabase
            .from("profiles").select("first_name, last_name, display_email").eq("id", userId).maybeSingle();
          const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ");
          who = name || p?.display_email || "A broker";
          if (p?.display_email && name) detail = p.display_email;
        }
      }

      const price = subscription.items.data[0]?.price;
      const amount = price?.unit_amount
        ? `$${(price.unit_amount / 100).toFixed(0)}/${price.recurring?.interval ?? "mo"}`
        : "";
      const plan = [price?.nickname, amount].filter(Boolean).join(" — ");

      const isNew = kind === "new";
      const subject = isNew
        ? `🎉 New subscriber: ${who}${amount ? ` (${amount})` : ""}`
        : `Subscription canceled: ${who}`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <div style="background:#050b14;padding:28px 40px;">
            <p style="margin:0;font-size:18px;font-weight:600;color:#ffffff;">YachtPics <span style="color:#c39e4e;">Portal</span> — Billing</p>
          </div>
          <div style="padding:32px 40px;">
            <p style="margin:0 0 4px;font-size:24px;font-weight:700;color:#111827;">${isNew ? "New subscriber 🎉" : "Subscription canceled"}</p>
            <p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;"><strong>${who}</strong>${detail ? ` &lt;${detail}&gt;` : ""}${plan ? ` — ${plan}` : ""}</p>
            <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">${isNew
              ? "Their payment cleared and the portal has already unlocked their account. Might be a nice moment for a personal welcome text."
              : "Their paid features are off; their photos and downloads stay available as always. Worth a check-in to hear why."}</p>
          </div>
        </div>
      </body></html>`;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "YachtPics Portal <hello@yachtpics.com>",
          to: "charlie@yachtpics.com",
          subject,
          html,
        }),
      });
    } catch { /* never fail the webhook over a notification */ }
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        await upsertSubscription(subscription);
        // Checkout completing IS the "someone just subscribed" moment — the
        // subscription.created/updated events fire repeatedly and would spam.
        await notifyCharlie(subscription, "new");
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
      await notifyCharlie(subscription, "canceled");
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
