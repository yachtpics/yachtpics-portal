import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessStatus, trialDaysRemaining } from "@/lib/subscriptionAccess";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("status, stripe_subscription_id, trial_ends_at")
    .eq("broker_id", user.id)
    .single();

  const status = getAccessStatus(sub ?? null);
  const daysLeft = trialDaysRemaining(sub?.trial_ends_at ?? null);

  return NextResponse.json({ status, daysLeft, trialEndsAt: sub?.trial_ends_at ?? null });
}
