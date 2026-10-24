import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { safeNextPath } from "@/lib/safeNext";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("broker_id", user.id)
    .single();

  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ error: "No billing account found" }, { status: 400 });
  }

  const origin = req.headers.get("origin") ?? "https://yachtpics-portal.vercel.app";

  // Optional { returnPath } (same-site path) — e.g. the listing page a Reel
  // Service "update your card" link came from. Default: Billing.
  const body = await req.json().catch(() => ({}));
  const returnPath = safeNextPath(typeof body?.returnPath === "string" ? body.returnPath : null) ?? "/dashboard/billing";

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${origin}${returnPath}`,
  });

  return NextResponse.json({ url: session.url });
}
