import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/publicSlideshow";
import { allowanceMessage, listingAllowance } from "@/lib/listingAllowance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/allowance → the signed-in broker's listing allowance
 * (src/lib/listingAllowance.ts) + the one-line nudge, for the Billing page.
 * Self-only, like the other billing routes. A nudge only — nothing blocked.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const allowance = await listingAllowance(serviceClient(), user.id);
    return NextResponse.json({ ...allowance, message: allowanceMessage(allowance) });
  } catch {
    return NextResponse.json({ over: false, message: null });
  }
}
