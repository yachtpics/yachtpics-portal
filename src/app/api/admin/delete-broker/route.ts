import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export async function DELETE(req: NextRequest) {
  try {
    const { brokerId } = await req.json();
    if (!brokerId) return NextResponse.json({ error: "Missing brokerId" }, { status: 400 });

    // Verify caller is admin
    const serverSupabase = await createServerClient();
    const { data: { user: caller } } = await serverSupabase.auth.getUser();
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: callerProfile } = await serverSupabase
      .from("profiles").select("role").eq("id", caller.id).single();
    if (callerProfile?.role !== "admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Get listing IDs for this broker
    const { data: listings } = await supabase
      .from("listings")
      .select("id")
      .eq("broker_id", brokerId);
    const listingIds = (listings ?? []).map((l) => l.id);

    // 2. Delete all listing-level child records
    if (listingIds.length > 0) {
      await supabase.from("slideshow_views").delete().in("listing_id", listingIds);
      await supabase.from("client_sends").delete().in("listing_id", listingIds);
      await supabase.from("photos").delete().in("listing_id", listingIds);
      await supabase.from("documents").delete().in("listing_id", listingIds);
      await supabase.from("videos").delete().in("listing_id", listingIds);
      await supabase.from("slideshows").delete().in("listing_id", listingIds);
    }

    // 3. Delete listings
    await supabase.from("listings").delete().eq("broker_id", brokerId);

    // 4. Delete broker-level records
    await supabase.from("broker_assistants").delete().eq("broker_id", brokerId);
    await supabase.from("invoices").delete().eq("broker_id", brokerId);
    await supabase.from("notifications").delete().eq("user_id", brokerId);
    await supabase.from("shoots").delete().eq("broker_id", brokerId);
    await supabase.from("broker_details").delete().eq("id", brokerId);
    await supabase.from("subscriptions").delete().eq("broker_id", brokerId);
    await supabase.from("profiles").delete().eq("id", brokerId);

    // 5. Delete auth user last
    const { error: authError } = await supabase.auth.admin.deleteUser(brokerId);
    if (authError) return NextResponse.json({ error: authError.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
