import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageAdmin } from "@/lib/requireBrokerageAdmin";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

// Open the Stripe billing portal for the brokerage's Office subscription.
export async function POST(req: NextRequest) {
  const auth = await requireBrokerageAdmin();
  if (auth.error) return auth.error;
  const { admin, brokerageId } = auth;

  const { data: brokerage } = await admin
    .from("brokerages")
    .select("stripe_customer_id")
    .eq("id", brokerageId)
    .single();

  if (!brokerage?.stripe_customer_id) {
    return NextResponse.json({ error: "No billing account yet." }, { status: 400 });
  }

  const origin = req.headers.get("origin") ?? "https://portal.yachtpics.com";
  const session = await stripe.billingPortal.sessions.create({
    customer: brokerage.stripe_customer_id,
    return_url: `${origin}/dashboard/brokerage/billing`,
  });

  return NextResponse.json({ url: session.url });
}
