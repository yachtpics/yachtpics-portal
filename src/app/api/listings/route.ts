import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      brokerId,
      vessel_name,
      vessel_type,
      year,
      length_ft,
      make,
      model,
      asking_price,
      location,
      description,
    } = body;

    // Auth check
    const serverSupabase = await createServerClient();
    const { data: { user: caller } } = await serverSupabase.auth.getUser();
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: callerProfile } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    const role = callerProfile?.role;

    let effectiveBrokerId: string;

    if (role === "broker") {
      // Broker always creates under their own account
      effectiveBrokerId = caller.id;
    } else if (role === "assistant") {
      // Assistant must supply a brokerId they are linked to
      if (!brokerId) {
        return NextResponse.json({ error: "brokerId is required for assistants." }, { status: 400 });
      }
      // Verify the link exists
      const { data: link } = await serverSupabase
        .from("broker_assistants")
        .select("broker_id")
        .eq("assistant_id", caller.id)
        .eq("broker_id", brokerId)
        .single();

      if (!link) {
        return NextResponse.json({ error: "You are not linked to this broker." }, { status: 403 });
      }
      effectiveBrokerId = brokerId;
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Use service role to bypass RLS for the insert
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: listing, error: listingError } = await supabase
      .from("listings")
      .insert({
        broker_id: effectiveBrokerId,
        vessel_name: vessel_name || null,
        vessel_type: vessel_type || null,
        year: year ? parseInt(year) : null,
        length_ft: length_ft ? parseFloat(length_ft) : null,
        make: make || null,
        model: model || null,
        asking_price: asking_price ? parseFloat(asking_price) : null,
        location: location || null,
        description: description || null,
        status: "active",
      })
      .select("id")
      .single();

    if (listingError || !listing) {
      return NextResponse.json({ error: listingError?.message ?? "Failed to create listing." }, { status: 500 });
    }

    return NextResponse.json({ success: true, listingId: listing.id, brokerId: effectiveBrokerId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
