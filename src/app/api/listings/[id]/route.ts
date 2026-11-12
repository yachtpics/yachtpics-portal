import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { demoGuard, demoRwOwnListing, isWritableDemoUser } from "@/lib/demoServer";

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
    // Read-only demo (layer 3 — src/lib/demo.ts).
    // The filming account (writable demo) may edit its OWN listings.
    { const demo = demoGuard(user, { allowWritableDemo: true }); if (demo) return demo; }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify caller has access to this listing
    const access = await assertListingAccess(supabaseAdmin, listingId, user.id);
    if (access instanceof NextResponse) return access;
    { const own = demoRwOwnListing(user, access.brokerId); if (own) return own; }

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
      "youtube_url",
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

    // The listing's YouTube video — only a youtube.com / youtu.be address is kept.
    if ("youtube_url" in updates) {
      const raw = typeof updates.youtube_url === "string" ? updates.youtube_url.trim() : "";
      const withScheme = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw;
      let ok = false;
      try {
        const u = new URL(withScheme);
        const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
        ok = ["http:", "https:"].includes(u.protocol) && (host === "youtube.com" || host === "youtu.be");
      } catch { ok = false; }
      if (raw && !ok) {
        return NextResponse.json({ error: "The YouTube link must be a youtube.com or youtu.be address." }, { status: 400 });
      }
      updates.youtube_url = ok ? withScheme.slice(0, 500) : null;
    }

    // Filming account: a deck plan must be its own file (path under its own
    // folder) — never a pointer at another broker's file.
    if (isWritableDemoUser(user) && "deck_plan_path" in updates && updates.deck_plan_path != null) {
      const dp = typeof updates.deck_plan_path === "string" ? updates.deck_plan_path : "";
      if (!dp.startsWith(`${user.id}/${listingId}/`) || dp.indexOf("..") >= 0) {
        return NextResponse.json({ error: "That deck plan file isn't on this listing." }, { status: 400 });
      }
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
