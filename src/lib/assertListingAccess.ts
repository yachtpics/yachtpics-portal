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
 *
 * NOTE ON BROKERAGE ADMINS (`opts.includeBrokerageAdmin`, default false):
 * a brokerage admin can ALREADY see and open any listing belonging to a broker
 * in their brokerage. Nothing here grants that — RLS does, through the brokerage
 * clause buried inside `assistant_has_access()`:
 *
 *     or exists (
 *       select 1 from profiles me join profiles tb on tb.id = broker
 *       where me.id = auth.uid()
 *         and me.is_brokerage_admin = true
 *         and me.brokerage_id is not null
 *         and me.brokerage_id = tb.brokerage_id
 *     )
 *
 * That function backs the `FOR ALL` policy "Assistants manage linked broker
 * listings", and /dashboard/listings and /dashboard/listings/[id] both read the
 * listings table directly under the user's own session — neither page calls this
 * helper. So those pages render for a brokerage admin whether or not the flag
 * below is set. What used to fail were the listing page's server-side extras
 * (thumbnails, video signing, engagement, AI description), which DO come through
 * here and were 403ing while the page around them worked.
 *
 * The flag is opt-in rather than automatic on purpose. It is deliberately NOT
 * enabled on the delete routes (photos / videos / documents), send-to-client,
 * the listings PATCH, reel-copy or reel-link. That lets a colleague's listing
 * page render fully for a brokerage admin without also handing them destructive
 * and outbound-email actions over another broker's content. Whether brokerage
 * admins should have those powers is a decision for the owner to take
 * deliberately — not something that should arrive as a side effect of fixing
 * thumbnails.
 */
export async function assertListingAccess(
  supabase: SupabaseClient,
  listingId: string,
  userId: string,
  opts: { includeCoBroker?: boolean; includeBrokerageAdmin?: boolean } = {}
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
    .select("role, is_brokerage_admin, brokerage_id")
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

  // Brokerage admin access — opt-in, read-side routes only. Mirrors the
  // brokerage clause of assistant_has_access() in RLS exactly: the caller is
  // flagged is_brokerage_admin, has a brokerage, and it is the same brokerage
  // as this listing's owner.
  if (opts.includeBrokerageAdmin && me?.is_brokerage_admin === true && me.brokerage_id != null) {
    const { data: owner } = await supabase
      .from("profiles")
      .select("brokerage_id")
      .eq("id", brokerId)
      .maybeSingle();
    if (owner?.brokerage_id != null && owner.brokerage_id === me.brokerage_id) {
      return { brokerId };
    }
  }

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
