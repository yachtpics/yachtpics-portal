import { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * WHO MAY ACT FOR A BROKER — the one rule, used by every server check that
 * asks "is this caller the broker, an admin, or someone working for them?".
 *
 *   owner        — the broker themselves.
 *   admin        — a YachtPics (portal) admin. Mirrors `is_admin()` in RLS.
 *   assistant    — linked to this broker in `broker_assistants`.
 *   office_admin — the caller's profile has is_brokerage_admin = true and a
 *                  brokerage_id, and it is the same brokerage_id as the
 *                  broker's. Owner decision Nov 25 2026: an office admin may
 *                  change listings in their own office exactly as that
 *                  broker's assistant can. This mirrors the brokerage clause
 *                  of `assistant_has_access()` / `rls_assisted_broker_ids()`
 *                  in RLS:
 *
 *       select tb.id from profiles me
 *       join profiles tb on tb.brokerage_id = me.brokerage_id
 *       where me.id = auth.uid() and me.is_brokerage_admin = true
 *         and me.brokerage_id is not null
 *
 * Billing is NOT part of this: an office admin never manages a colleague's
 * Stripe subscription or Reel Service (see reelServiceCaller.ts, which refuses
 * office admins on purpose).
 *
 * Co-brokers are not here either — they are per listing and opt-in
 * (assertListingAccess `includeCoBroker`).
 */
export type BrokerActor = "owner" | "admin" | "assistant" | "office_admin";

type OfficeProfile = { is_brokerage_admin?: boolean | null; brokerage_id?: string | null } | null | undefined;

/** The office-admin comparison itself (pure). Both sides need a brokerage. */
export function isOfficeAdminOf(me: OfficeProfile, ownerBrokerageId: string | null | undefined): boolean {
  return (
    me?.is_brokerage_admin === true &&
    me.brokerage_id != null &&
    ownerBrokerageId != null &&
    ownerBrokerageId === me.brokerage_id
  );
}

/**
 * Is `userId` an office admin of `brokerId`'s brokerage? Reads the broker's
 * brokerage only when the caller is an office admin at all. Pass `me` when the
 * caller's profile is already loaded.
 */
export async function isOfficeAdminForBroker(
  svc: SupabaseClient,
  userId: string,
  brokerId: string,
  me?: OfficeProfile
): Promise<boolean> {
  let caller = me;
  if (caller === undefined) {
    const { data } = await svc
      .from("profiles")
      .select("is_brokerage_admin, brokerage_id")
      .eq("id", userId)
      .maybeSingle();
    caller = data;
  }
  if (caller?.is_brokerage_admin !== true || caller.brokerage_id == null) return false;
  const { data: owner } = await svc
    .from("profiles")
    .select("brokerage_id")
    .eq("id", brokerId)
    .maybeSingle();
  return isOfficeAdminOf(caller, owner?.brokerage_id ?? null);
}

/** How `userId` may act for `brokerId` — or null when they may not. */
export async function brokerActor(
  svc: SupabaseClient,
  userId: string,
  brokerId: string
): Promise<BrokerActor | null> {
  if (brokerId === userId) return "owner";

  const { data: me } = await svc
    .from("profiles")
    .select("role, is_brokerage_admin, brokerage_id")
    .eq("id", userId)
    .maybeSingle();
  if (me?.role === "admin") return "admin";

  const { data: link } = await svc
    .from("broker_assistants")
    .select("broker_id")
    .eq("broker_id", brokerId)
    .eq("assistant_id", userId)
    .maybeSingle();
  if (link) return "assistant";

  if (await isOfficeAdminForBroker(svc, userId, brokerId, me ?? null)) return "office_admin";
  return null;
}

/** True when `userId` is the broker, an admin, a linked assistant or an office admin of the broker's brokerage. */
export async function canActForBroker(svc: SupabaseClient, userId: string, brokerId: string): Promise<boolean> {
  return (await brokerActor(svc, userId, brokerId)) !== null;
}

/** Plain refusal wording for a broker-side save — never a bare "Forbidden". */
export const NO_LISTING_ACCESS_MESSAGE = "You don't have access to change this listing.";

export function listingRefusalMessage(ownerName: string | null): string {
  return ownerName
    ? `Only ${ownerName}, their assistant or their office admin can change this listing.`
    : NO_LISTING_ACCESS_MESSAGE;
}

/**
 * The 403 for a signed-in user who isn't allowed to act on this listing. Names
 * the owner only when the caller may already SEE the listing (a co-broker on
 * it, or a broker of the same brokerage when the listing is shared into the
 * office — the two RLS read grants beyond the acting roles); anyone else gets
 * the generic sentence, so a refusal never tells a stranger whose boat it is.
 */
async function refusal(
  svc: SupabaseClient,
  listing: { id: string; broker_id: string; is_shared?: boolean | null },
  userId: string
): Promise<NextResponse> {
  let canSee = false;
  const { data: co } = await svc
    .from("listing_co_brokers")
    .select("broker_id")
    .eq("listing_id", listing.id)
    .eq("broker_id", userId)
    .maybeSingle();
  if (co) canSee = true;

  if (!canSee && listing.is_shared === true) {
    const [{ data: me }, { data: owner }] = await Promise.all([
      svc.from("profiles").select("role, brokerage_id").eq("id", userId).maybeSingle(),
      svc.from("profiles").select("brokerage_id").eq("id", listing.broker_id).maybeSingle(),
    ]);
    canSee =
      me?.role === "broker" &&
      me.brokerage_id != null &&
      owner?.brokerage_id != null &&
      me.brokerage_id === owner.brokerage_id;
  }

  let ownerName: string | null = null;
  if (canSee) {
    const { data: p } = await svc
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", listing.broker_id)
      .maybeSingle();
    ownerName = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || null;
  }
  return NextResponse.json({ error: listingRefusalMessage(ownerName) }, { status: 403 });
}

/**
 * Verifies that `userId` may act on `listingId`: the listing's broker, a
 * portal admin, a linked assistant, or an office admin of the broker's
 * brokerage (brokerActor above) — and, only when `opts.includeCoBroker` is set,
 * a co-broker on this listing (sending, uploads; never the delete routes).
 *
 * Returns { brokerId, actor } on success, or a NextResponse 403/404 the caller
 * should return immediately. A 403 carries a plain sentence (listingRefusalMessage).
 *
 * Admins belong here: RLS grants them every listing, and leaving them out once
 * meant an admin's Delete silently came back.
 */
export async function assertListingAccess(
  supabase: SupabaseClient,
  listingId: string,
  userId: string,
  opts: { includeCoBroker?: boolean } = {}
): Promise<{ brokerId: string; actor: BrokerActor | "co_broker" } | NextResponse> {
  const { data: listing } = await supabase
    .from("listings")
    .select("id, broker_id, is_shared")
    .eq("id", listingId)
    .single();

  if (!listing) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  const brokerId: string = listing.broker_id;

  const actor = await brokerActor(supabase, userId, brokerId);
  if (actor) return { brokerId, actor };

  // Co-broker access — opt-in, only for routes that should allow it (e.g. sending).
  // Delete routes deliberately omit this so co-brokers can't remove content.
  if (opts.includeCoBroker) {
    const { data: co } = await supabase
      .from("listing_co_brokers")
      .select("broker_id")
      .eq("listing_id", listingId)
      .eq("broker_id", userId)
      .maybeSingle();
    if (co) return { brokerId, actor: "co_broker" };
  }

  return refusal(supabase, { id: listingId, broker_id: brokerId, is_shared: listing.is_shared }, userId);
}
