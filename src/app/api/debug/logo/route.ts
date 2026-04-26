import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "Pass ?slug=your-slideshow-slug" });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: listing } = await supabaseAdmin
    .from("listings")
    .select("id, vessel_name, broker_id")
    .eq("slideshow_slug", slug)
    .single();

  if (!listing) return NextResponse.json({ error: "Listing not found for that slug" });

  const { data: brokerDetails } = await supabaseAdmin
    .from("broker_details")
    .select("id, brokerage_name, logo_url")
    .eq("id", listing.broker_id)
    .single();

  return NextResponse.json({
    listing_broker_id: listing.broker_id,
    vessel_name: listing.vessel_name,
    broker_details_found: brokerDetails,
  });
}
