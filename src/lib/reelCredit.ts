import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whose name goes on a listing reel (Nov 1) — SERVER ONLY (service client).
 *
 * A reel credits the broker it was made FOR, not automatically the listing
 * owner, so a co-broker can market the boat as their own:
 *   signed-in owner                         → the owner
 *   signed-in co-broker (listing_co_brokers) → that co-broker
 *   assistant → the broker they assist on this listing (owner preferred
 *               when they assist both the owner and a co-broker)
 *   brokerage admin on a colleague's listing → the owner
 *   admin → whoever they pick (owner or a co-broker; default owner). The
 *           Reel Service renderer passes the job's broker.
 * Only the owner or a co-broker of THIS listing can ever be credited.
 * The slideshow and website are untouched — they keep the owner.
 */

export type ReelCreditCard = {
  name: string;
  brokerage: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
};

export type ReelCredit = {
  ownerId: string;
  creditBrokerId: string;
  card: ReelCreditCard;
  brand: { accent: string | null; ground: string | null };
  /** Admins only: who the reel can be for (owner first), for the Credit chip. */
  options: { id: string; name: string; isOwner: boolean }[] | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fullName(p: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  return [p?.first_name, p?.last_name].filter(Boolean).join(" ");
}

/** The listing's owner and co-brokers, or null if the listing doesn't exist. */
export async function listingCreditCandidates(svc: SupabaseClient, listingId: string): Promise<{ ownerId: string; coIds: string[] } | null> {
  const [{ data: l }, { data: co }] = await Promise.all([
    svc.from("listings").select("broker_id").eq("id", listingId).maybeSingle(),
    svc.from("listing_co_brokers").select("broker_id, created_at").eq("listing_id", listingId).order("created_at"),
  ]);
  if (!l?.broker_id) return null;
  const ownerId = l.broker_id as string;
  const coIds = Array.from(new Set((co ?? []).map((c) => c.broker_id as string).filter((id) => id && id !== ownerId)));
  return { ownerId, coIds };
}

/**
 * A broker id a client says a reel was made for, checked: the owner or a
 * co-broker of the listing, else the owner. For records (reel_events,
 * social_posts) so nothing can be filed against an unrelated broker.
 */
export async function validCreditBrokerId(svc: SupabaseClient, listingId: string, requested: unknown): Promise<string | null> {
  const c = await listingCreditCandidates(svc, listingId);
  if (!c) return null;
  if (typeof requested === "string" && UUID_RE.test(requested) && (requested === c.ownerId || c.coIds.includes(requested))) return requested;
  return c.ownerId;
}

/** Who the signed-in user's reel credits, with that broker's card. null = no access. */
export async function resolveReelCredit(
  svc: SupabaseClient,
  listingId: string,
  userId: string,
  requested?: string | null
): Promise<ReelCredit | null> {
  const c = await listingCreditCandidates(svc, listingId);
  if (!c) return null;
  const { ownerId, coIds } = c;
  const candidates = [ownerId, ...coIds];

  const { data: me } = await svc.from("profiles").select("role, is_brokerage_admin, brokerage_id").eq("id", userId).maybeSingle();
  const role = (me?.role as string | undefined) ?? "broker";

  let credit: string | null = null;
  const isAdmin = role === "admin";
  if (isAdmin) {
    credit = requested && candidates.includes(requested) ? requested : ownerId;
  } else if (userId === ownerId) {
    credit = ownerId;
  } else if (coIds.includes(userId)) {
    credit = userId;
  } else if (role === "assistant") {
    const { data: links } = await svc.from("broker_assistants").select("broker_id").eq("assistant_id", userId);
    const assisted = new Set((links ?? []).map((l) => l.broker_id as string));
    credit = assisted.has(ownerId) ? ownerId : coIds.find((id) => assisted.has(id)) ?? null;
  } else if (me?.is_brokerage_admin === true && me.brokerage_id != null) {
    const { data: owner } = await svc.from("profiles").select("brokerage_id").eq("id", ownerId).maybeSingle();
    if (owner?.brokerage_id != null && owner.brokerage_id === me.brokerage_id) credit = ownerId;
  }
  if (!credit) return null;

  const [{ data: prof }, { data: det }, names] = await Promise.all([
    svc.from("profiles").select("first_name, last_name, phone, display_email").eq("id", credit).maybeSingle(),
    svc.from("broker_details").select("brokerage_name, brokerage_website, logo_url, brand_accent, brand_ground").eq("id", credit).maybeSingle(),
    isAdmin && coIds.length > 0
      ? svc.from("profiles").select("id, first_name, last_name").in("id", candidates).then((r) => r.data ?? [])
      : Promise.resolve(null),
  ]);

  let options: ReelCredit["options"] = null;
  if (isAdmin && names) {
    const byId = new Map((names as { id: string; first_name: string | null; last_name: string | null }[]).map((p) => [p.id, fullName(p)]));
    options = candidates.map((id) => ({ id, name: byId.get(id) || (id === ownerId ? "Listing broker" : "Co-broker"), isOwner: id === ownerId }));
  }

  return {
    ownerId,
    creditBrokerId: credit,
    card: {
      name: fullName(prof),
      brokerage: (det?.brokerage_name as string | null) ?? null,
      phone: (prof?.phone as string | null) ?? null,
      email: (prof?.display_email as string | null) ?? null,
      website: (det?.brokerage_website as string | null) ?? null,
      logoUrl: (det?.logo_url as string | null) ?? null,
    },
    brand: { accent: (det?.brand_accent as string | null) ?? null, ground: (det?.brand_ground as string | null) ?? null },
    options,
  };
}
