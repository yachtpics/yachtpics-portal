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
  // Assistants only: the broker's name, so plan gates can say whose plan it is
  // ("Needs Jim Nobel's plan") — src/lib/planValue.ts assistantPlanCopy.
  let brokerName: { first: string | null; last: string | null } | null = null;

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
    const { data: bp } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", brokerId)
      .maybeSingle();
    brokerName = { first: bp?.first_name ?? null, last: bp?.last_name ?? null };
  }

  // Use service role so RLS on subscriptions table never blocks the read
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Effective status accounts for the broker's own plan OR their office plan.
  const { status, trialEndsAt, trialDays, officeCovered, reelServiceCovered } = await getEffectiveAccessStatus(supabaseAdmin, brokerId);
  const daysLeft = trialDaysRemaining(trialEndsAt);

  // trialDays: this broker's trial length (14, or 30 for accounts opened
  // before Oct 24 2026) — see trialDaysFor in subscriptionAccess.ts.
  return NextResponse.json({ status, daysLeft, trialEndsAt, trialDays, officeCovered, reelServiceCovered: !!reelServiceCovered, brokerName });
}
