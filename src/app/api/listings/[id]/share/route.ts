import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Toggle whether a listing is shared into its brokerage's "house"/new inventory.
// Only the brokerage admin (for boats in their own brokerage) or a YachtPics
// admin may flip this — individual brokers cannot share their own boats.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const listingId = params.id;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { shared?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const shared = body.shared === true;

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Who is asking?
  const { data: me } = await service
    .from("profiles")
    .select("role, is_brokerage_admin, brokerage_id")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "Profile not found" }, { status: 403 });

  // The listing + its owner's brokerage
  const { data: listing } = await service
    .from("listings")
    .select("id, broker_id")
    .eq("id", listingId)
    .single();
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

  const { data: owner } = await service
    .from("profiles")
    .select("brokerage_id")
    .eq("id", listing.broker_id)
    .single();

  const isYachtPicsAdmin = me.role === "admin";
  const isBrokerageAdminForThisBoat =
    me.is_brokerage_admin === true &&
    me.brokerage_id != null &&
    owner?.brokerage_id != null &&
    owner.brokerage_id === me.brokerage_id;

  if (!isYachtPicsAdmin && !isBrokerageAdminForThisBoat) {
    return NextResponse.json({ error: "Not authorized to share this listing" }, { status: 403 });
  }

  const { error } = await service
    .from("listings")
    .update({ is_shared: shared })
    .eq("id", listingId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, shared });
}
