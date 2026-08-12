import { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Verifies that `userId` has access to `listingId` — as the listing's broker, a
 * linked assistant, or an admin.
 *
 * Returns the listing's broker_id on success.
 * Returns a NextResponse 403/404 on failure (caller should return it immediately).
 *
 * NOTE ON ADMINS: they belong here. The database's own RLS grants admins access
 * to every listing (`is_admin()`), and the admin UI shows every listing — so
 * omitting them meant an admin could open any broker's listing, press Delete,
 * watch the item disappear from the screen, and have it silently return. The
 * request was being refused with a 403 the whole time.
 */
export async function assertListingAccess(
  supabase: SupabaseClient,
  listingId: string,
  userId: string,
  opts: { includeCoBroker?: boolean } = {}
): Promise<{ brokerId: string } | NextResponse> {
  const { data: listing } = await supabase
    .from("listings")
    .select("broker_id")
    .eq("id", listingId)
    .single();

  if (!listing) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  const brokerId: string = listing.broker_id;

  // Direct broker access
  if (brokerId === userId) {
    return { brokerId };
  }

  // Admin access — mirrors the is_admin() grant in the database's RLS policies.
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (me?.role === "admin") return { brokerId };

  // Assistant access — must be linked to this listing's broker
  const { data: link } = await supabase
    .from("broker_assistants")
    .select("broker_id")
    .eq("broker_id", brokerId)
    .eq("assistant_id", userId)
    .maybeSingle();
  if (link) return { brokerId };

  // Co-broker access — opt-in, only for routes that should allow it (e.g. sending).
  // Delete routes deliberately omit this so co-brokers can't remove content.
  if (opts.includeCoBroker) {
    const { data: co } = await supabase
      .from("listing_co_brokers")
      .select("broker_id")
      .eq("listing_id", listingId)
      .eq("broker_id", userId)
      .maybeSingle();
    if (co) return { brokerId };
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
