import { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Verifies that `userId` has access to `listingId` — either as the listing's broker
 * or as a linked assistant.
 *
 * Returns the listing's broker_id on success.
 * Returns a NextResponse 403/404 on failure (caller should return it immediately).
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
