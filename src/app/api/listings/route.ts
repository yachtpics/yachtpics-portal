import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { demoGuard, isWritableDemoUser } from "@/lib/demoServer";
import { brokerActor, isOfficeAdminForBroker } from "@/lib/assertListingAccess";

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
    // Read-only demo (layer 3 — src/lib/demo.ts). The filming account (writable
    // demo) may create listings — always private, forced below and by the
    // listings trigger in migration 20261112_demo_rw_filming_account.sql.
    { const demo = demoGuard(caller, { allowWritableDemo: true }); if (demo) return demo; }
    const filming = isWritableDemoUser(caller);

    const { data: callerProfile } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    const role = callerProfile?.role;

    let effectiveBrokerId: string;

    if (filming && role !== "broker") {
      return NextResponse.json({ error: "You don't have access to add listings." }, { status: 403 });
    }

    // Service role: the access checks and the insert (bypasses RLS).
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const otherBroker = typeof brokerId === "string" && brokerId !== caller.id ? brokerId : null;

    if (role === "broker") {
      // A broker creates under their own account — unless they are the office
      // admin of the broker they name (an office admin acts for a colleague
      // the way that broker's assistant does). The filming account always
      // creates its own.
      effectiveBrokerId = caller.id;
      if (otherBroker && !filming) {
        if (!(await isOfficeAdminForBroker(supabase, caller.id, otherBroker))) {
          return NextResponse.json({ error: "You can only add listings for brokers in your own office." }, { status: 403 });
        }
        effectiveBrokerId = otherBroker;
      }
    } else if (role === "assistant") {
      // Assistant must supply a brokerId they work for (linked, or — when the
      // assistant is also an office admin — a broker in their office).
      if (!brokerId) {
        return NextResponse.json({ error: "brokerId is required for assistants." }, { status: 400 });
      }
      const actor = await brokerActor(supabase, caller.id, brokerId);
      if (actor !== "assistant" && actor !== "office_admin") {
        return NextResponse.json({ error: "You are not linked to this broker." }, { status: 403 });
      }
      effectiveBrokerId = brokerId;
    } else {
      return NextResponse.json({ error: "You don't have access to add listings." }, { status: 403 });
    }

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
        // Filming account: a pocket listing that can never reach the website,
        // the showcase or Recently Photographed, whatever the client sent.
        ...(filming
          ? {
              showcase_opt_out: true,
              showcase_opt_out_by: caller.id,
              showcase_opt_out_at: new Date().toISOString(),
              in_showcase: false,
              publish_to_site: false,
              site_hidden: true,
              is_shared: false,
            }
          : {}),
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

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
