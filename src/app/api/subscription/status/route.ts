import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { trialDaysRemaining } from "@/lib/subscriptionAccess";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Optional: caller can supply a brokerId (e.g. listing page for assistants).
  // We verify the caller is either that broker or a linked assistant before
  // returning the subscription, so this is safe.
  const url = new URL(req.url);
  const requestedBrokerId = url.searchParams.get("brokerId");

  let brokerId = user.id;

  if (requestedBrokerId && requestedBrokerId !== user.id) {
    // Caller is asking about a different broker — verify they are linked
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: link } = await supabaseAdmin
      .from("broker_assistants")
      .select("broker_id")
      .eq("broker_id", requestedBrokerId)
      .eq("assistant_id", user.id)
      .maybeSingle();

    if (!link) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    brokerId = requestedBrokerId;
  }

  // Use service role so RLS on subscriptions table never blocks the read
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Effective status accounts for the broker's own plan OR their office plan.
  const { status, trialEndsAt, officeCovered } = await getEffectiveAccessStatus(supabaseAdmin, brokerId);
  const daysLeft = trialDaysRemaining(trialEndsAt);

  return NextResponse.json({ status, daysLeft, trialEndsAt, officeCovered });
}
