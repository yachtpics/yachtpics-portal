import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { unpublishFromSite } from "@/lib/sitePublish";

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
  const { data: listing } = await service
    .from("listings")
    .select("broker_id, publish_to_site")
    .eq("id", listingId)
    .single();
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

  // A boat marked private AFTER it went live has to actually come down.
  //
  // Setting the flag alone used to leave the page sitting on yachtpics.com,
  // which made the veto cosmetic: the broker asked for a pocket listing and
  // the boat stayed reachable by anyone with the address. Six Waterfront boats
  // ended up in exactly that state before this was caught (2026-08-21).
  //
  // Takedown failures are reported but don't fail the request — the broker's
  // instruction is recorded either way, and a stuck page is a YachtPics
  // problem to chase, not something to bounce back at them.
  if (optOut && listing.publish_to_site) {
    const { warnings, error: takedownError } = await unpublishFromSite(listingId);
    if (takedownError || warnings.length) {
      return NextResponse.json({
        success: true,
        optOut,
        removedFromSite: !takedownError,
        warning: takedownError ?? warnings.join(" "),
      });
    }
    return NextResponse.json({ success: true, optOut, removedFromSite: true });
  }

  return NextResponse.json({ success: true, optOut });
}
