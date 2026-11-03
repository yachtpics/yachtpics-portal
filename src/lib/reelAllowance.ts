import type { SupabaseClient } from "@supabase/supabase-js";
import { REEL_PROMO_END, reelPromoActive } from "@/lib/reelPromo";
import { hasAccess } from "@/lib/subscriptionAccess";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";

/**
 * The Reel allowance — two included reels per listing (from Oct 1 2026 ET).
 *
 * Policy (Charlie, Sept 29):
 *   - Subscribers (the listing broker's own plan or their office plan — the
 *     same answer /api/subscription/status gives) and admins: unlimited.
 *   - While the open house runs: unlimited for everyone.
 *   - Everyone else: two reels per listing, free and clean. A reel counts
 *     when it is TAKEN OFF THE PAGE — download, send to phone, save to camera
 *     roll, add to listing. Rendering and previewing never count, and taking
 *     the same render twice is still one reel.
 *   - Counting starts fresh when the open house closes.
 *
 * The server is the authority. Each distinct render taken is one `claim` row
 * in reel_events (render_id = the id the browser gave that render). A partial
 * unique index on (listing_id, render_id) makes the same render idempotent.
 */

export const REELS_PER_LISTING = 2;

export type Allowance = { unlimited: true } | { unlimited: false; used: number; remaining: number };

/** True when this listing's reels are unmetered right now. */
export async function reelsUnlimited(
  service: SupabaseClient,
  opts: { userId: string; brokerId: string }
): Promise<{ unlimited: boolean; role: string | null }> {
  const { data: me } = await service.from("profiles").select("role").eq("id", opts.userId).maybeSingle();
  const role: string | null = me?.role ?? null;
  if (role === "admin") return { unlimited: true, role };
  if (reelPromoActive()) return { unlimited: true, role };
  const { status } = await getEffectiveAccessStatus(service, opts.brokerId);
  return { unlimited: hasAccess(status), role };
}

/**
 * THE counting rule, in one place: from claim rows in creation order, keep the
 * distinct render ids, skipping admin claims and rows without a render id.
 * claimedRenders (one listing) and claimedCountsByListing (many) both use it.
 */
function distinctClaims(rows: { render_id: string | null; role: string | null }[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const r of rows) {
    if (r.role === "admin" || !r.render_id) continue;
    const id = r.render_id as string;
    if (!seen[id]) { seen[id] = true; out.push(id); }
  }
  return out;
}

/**
 * The distinct renders already claimed on this listing since the open house
 * closed, oldest first (ties broken by row id, so every caller sees the same
 * order — the claim route relies on that to settle a race).
 */
export async function claimedRenders(service: SupabaseClient, listingId: string): Promise<string[]> {
  const { data, error } = await service
    .from("reel_events")
    .select("render_id, role")
    .eq("listing_id", listingId)
    .eq("kind", "claim")
    .gt("created_at", REEL_PROMO_END)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  return distinctClaims((data ?? []) as { render_id: string | null; role: string | null }[]);
}

/**
 * Included reels used, for many listings in ONE query (My Listings line,
 * monthly email). Same rule as claimedRenders; a listing with no claims is 0.
 * `client` may be the service client or a user client — reel_events is
 * admin-read under RLS, so pass the service client for broker pages.
 */
export async function claimedCountsByListing(client: SupabaseClient, listingIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  listingIds.forEach((id) => out.set(id, 0));
  if (listingIds.length === 0) return out;
  const byListing = new Map<string, { render_id: string | null; role: string | null }[]>();
  // Chunked only so the id list stays a sane URL length; one query per 150 boats.
  for (let i = 0; i < listingIds.length; i += 150) {
    const { data, error } = await client
      .from("reel_events")
      .select("listing_id, render_id, role")
      .in("listing_id", listingIds.slice(i, i + 150))
      .eq("kind", "claim")
      .gt("created_at", REEL_PROMO_END)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { listing_id: string; render_id: string | null; role: string | null }[]) {
      const list = byListing.get(r.listing_id) ?? [];
      list.push(r);
      byListing.set(r.listing_id, list);
    }
  }
  byListing.forEach((rows, id) => out.set(id, distinctClaims(rows).length));
  return out;
}

/**
 * Reels taken off the page on this listing by anyone but YachtPics — download,
 * send to phone, save to camera roll, add to listing. For a plan (unlimited)
 * listing no claim is recorded, so this is how "has she had a reel made" is
 * answered there. Counts events, not distinct reels (those rows carry no render id).
 */
export async function reelsTakenCount(service: SupabaseClient, listingId: string): Promise<number> {
  const { count, error } = await service
    .from("reel_events")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", listingId)
    .in("kind", ["download", "send_to_phone", "save_to_camera_roll", "added_to_listing", "claim"])
    .or("role.is.null,role.neq.admin");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export function remainingOf(used: number): number {
  return Math.max(0, REELS_PER_LISTING - used);
}
