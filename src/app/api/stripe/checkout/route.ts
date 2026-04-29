import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { PLANS } from "@/lib/plans";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { priceId } = await req.json();

    // Validate priceId is one of ours
    const plan = PLANS.find((p) => p.priceId === priceId);
    if (!plan) return NextResponse.json({ error: `Invalid plan. Received: ${priceId}` }, { status: 400 });

    // Use service role to bypass RLS for subscription writes
    const serviceSupabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get broker's profile for prefill
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", user.id)
      .single();

    // Check if broker already has a Stripe customer ID and whether they've used a trial
    const { data: sub } = await serviceSupabase
      .from("subscriptions")
      .select("stripe_customer_id, trial_ends_at")
      .eq("broker_id", user.id)
      .single();

    let customerId = sub?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: profile ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() : undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      // Save customer ID using service role
      await serviceSupabase
        .from("subscriptions")
        .upsert({ broker_id: user.id, stripe_customer_id: customerId }, { onConflict: "broker_id" });
    }

    const origin = req.headers.get("origin") ?? "https://yachtpics-portal.vercel.app";

    // Only grant a trial if the broker has never had one.
    // Passing undefined is identical to omitting the property in Stripe's SDK.
    const hasUsedTrial = !!sub?.trial_ends_at;
    const trialDays = hasUsedTrial ? undefined : 30;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard/billing?success=1`,
      cancel_url: `${origin}/dashboard/billing?cancelled=1`,
      subscription_data: {
        trial_period_days: trialDays,
        metadata: { supabase_user_id: user.id },
      },
      metadata: { supabase_user_id: user.id },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
