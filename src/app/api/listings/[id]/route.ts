import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";

// PATCH /api/listings/[id] — update listing details
// Allowed for the listing's broker OR a linked assistant
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const listingId = params.id;

    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify caller has access to this listing
    const access = await assertListingAccess(supabaseAdmin, listingId, user.id);
    if (access instanceof NextResponse) return access;

    const body = await req.json();

    // Allowlist the fields that can be updated
    const allowed = [
      "vessel_name",
      "vessel_type",
      "year",
      "length_ft",
      "make",
      "model",
      "asking_price",
      "location",
      "description",
      "status",
      "beam_ft",
      "draft_ft",
      "staterooms",
      "heads",
      "engines",
      "engine_hours",
      "fuel_type",
      "cruising_speed_kn",
      "max_speed_kn",
      "hull_material",
      "tour_url",
      "deck_plan_path",
    ];

    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }
    // A tour link must be a real web address — nothing else gets stored.
    if ("tour_url" in updates) {
      const raw = typeof updates.tour_url === "string" ? updates.tour_url.trim() : "";
      const withScheme = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw;
      let ok = false;
      try { ok = !!withScheme && ["http:", "https:"].includes(new URL(withScheme).protocol); } catch { ok = false; }
      updates.tour_url = ok ? withScheme.slice(0, 500) : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const { error: updateError } = await supabaseAdmin
      .from("listings")
      .update(updates)
      .eq("id", listingId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
