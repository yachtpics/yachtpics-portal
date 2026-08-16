import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// The listing broker's veto over the Recently Photographed showcase. Even if a
// YachtPics admin features the boat, setting this keeps it a pocket listing.
// The owner, their assistants, a co-broker, or an admin may set it.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const listingId = params.id;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { optOut?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const optOut = body.optOut === true;

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: me } = await service.from("profiles").select("role").eq("id", user.id).single();
  const { data: listing } = await service.from("listings").select("broker_id").eq("id", listingId).single();
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

  let allowed = me?.role === "admin" || listing.broker_id === user.id;
  if (!allowed) {
    const { data: asst } = await service
      .from("broker_assistants")
      .select("id")
      .eq("broker_id", listing.broker_id)
      .eq("assistant_id", user.id)
      .maybeSingle();
    if (asst) allowed = true;
  }
  if (!allowed) {
    const { data: co } = await service
      .from("listing_co_brokers")
      .select("id")
      .eq("listing_id", listingId)
      .eq("broker_id", user.id)
      .maybeSingle();
    if (co) allowed = true;
  }
  if (!allowed) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const { error } = await service.from("listings").update({ showcase_opt_out: optOut }).eq("id", listingId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, optOut });
}
