import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { trialDaysRemaining } from "@/lib/subscriptionAccess";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { canActForBroker } from "@/lib/assertListingAccess";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Optional: caller can supply a brokerId (the listing page, when the viewer
  // isn't the listing's own broker). Allowed callers — the same people who can
  // already open that broker's listings: the broker, a linked assistant, a
  // portal admin, or an office admin of the broker's own brokerage
  // (canActForBroker — the same rule as assertListingAccess). Read-only plan
  // status; nothing here manages the broker's subscription.
  const url = new URL(req.url);
  const requestedBrokerId = url.searchParams.get("brokerId");

  let brokerId = user.id;
  // Anyone viewing another broker's listing: that broker's name, so plan
  // gates can say whose plan it is
  // ("Needs Jim Nobel's plan") — src/lib/planValue.ts assistantPlanCopy.
  let brokerName: { first: string | null; last: string | null } | null = null;

  if (requestedBrokerId && requestedBrokerId !== user.id) {
    // Caller is asking about a different broker — verify they are linked
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    // Linked assistant, portal admin, or office admin of the broker's
    // brokerage — the shared rule in src/lib/assertListingAccess.ts.
    const allowed = await canActForBroker(supabaseAdmin, user.id, requestedBrokerId);
    if (!allowed) return NextResponse.json({ error: "You don't have access to this broker's plan." }, { status: 403 });
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
  // Also a paying office admin's own plan (officeAdminCovered, Nov 25 2026 —
  // OFFICE_ADMIN_PLAN_COVERS_OFFICE in brokerAccess.ts).
  const { status, trialEndsAt, trialDays, officeCovered, reelServiceCovered, officeAdminCovered, officeAdminCover } = await getEffectiveAccessStatus(supabaseAdmin, brokerId);
  const daysLeft = trialDaysRemaining(trialEndsAt);

  // trialDays: this broker's trial length (14, or 30 for accounts opened
  // before Oct 24 2026) — see trialDaysFor in subscriptionAccess.ts.
  return NextResponse.json({
    status, daysLeft, trialEndsAt, trialDays, officeCovered, reelServiceCovered: !!reelServiceCovered, brokerName,
    officeAdminCovered: !!officeAdminCovered,
    // "Your Portal tools are covered by Kelly Sprigg's plan (SYC Yachts)."
    officeAdminName: officeAdminCover?.adminName ?? null,
    officeName: officeAdminCover?.officeName ?? null,
  });
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
