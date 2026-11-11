/**
 * The demo account — server-side helpers (Nov 10, 2026). See src/lib/demo.ts.
 *
 * `demo_accounts` (migration 20261110_demo_link.sql, service role only) holds
 * the demo user's id and its sample listing's id. It is written ONLY by the
 * demo_seed / demo_reset jobs. The business-facing counts (/see, admin
 * dashboard) use it to leave the demo out. Before the migration is applied
 * the table is missing and every helper here answers "no demo account" —
 * nothing changes.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_BLOCK_HEADER, DEMO_READ_ONLY_MESSAGE, isDemoUser } from "@/lib/demo";
import { createClient as createSessionClient } from "@/lib/supabase/server";

export { isDemoUser };

/** The 403 every demo guard answers with (same body as the middleware's). */
export function demoForbidden(): NextResponse {
  return NextResponse.json(
    { error: DEMO_READ_ONLY_MESSAGE, demo: true },
    { status: 403, headers: { [DEMO_BLOCK_HEADER]: "1", "Cache-Control": "no-store" } }
  );
}

/** Layer 3: a 403 for a demo user, else null. `user` must come from getUser(). */
export function demoGuard(user: { app_metadata?: Record<string, unknown> | null } | null | undefined): NextResponse | null {
  return isDemoUser(user) ? demoForbidden() : null;
}

/**
 * Layer 3 for routes whose auth goes through a shared helper that doesn't
 * hand back the user (Reel Service checkout / cancel, website add / remove):
 * one extra getUser() for this request. Route handlers only.
 */
export async function demoGuardFromSession(): Promise<NextResponse | null> {
  try {
    const supabase = await createSessionClient();
    const { data: { user } } = await supabase.auth.getUser();
    return demoGuard(user);
  } catch {
    return null;
  }
}

export type DemoAccountRow = {
  user_id: string;
  email: string | null;
  listing_id: string | null;
  source_listing_id: string | null;
};

let cache: { at: number; rows: DemoAccountRow[] } | null = null;
const CACHE_MS = 60_000;

/** Every demo account (normally one). [] when the table is missing or on any error. */
export async function getDemoAccounts(svc: SupabaseClient, opts: { fresh?: boolean } = {}): Promise<DemoAccountRow[]> {
  if (!opts.fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  try {
    const { data, error } = await svc.from("demo_accounts").select("user_id, email, listing_id, source_listing_id");
    if (error) {
      // Before the migration (table missing) remember "none" so public routes
      // don't pay a failed query each; any other error isn't cached.
      if (/does not exist|could not find the table/i.test(error.message ?? "")) cache = { at: Date.now(), rows: [] };
      return [];
    }
    const rows = (data ?? []) as DemoAccountRow[];
    cache = { at: Date.now(), rows };
    return rows;
  } catch {
    return [];
  }
}

/** Demo user ids, for leaving the demo out of counts and audiences. */
export async function demoUserIds(svc: SupabaseClient): Promise<string[]> {
  return (await getDemoAccounts(svc)).map((r) => r.user_id);
}

/** Every listing id owned by a demo user (the sample boat; normally one). */
export async function demoListingIds(svc: SupabaseClient): Promise<string[]> {
  const ids = await demoUserIds(svc);
  if (ids.length === 0) return [];
  try {
    const { data, error } = await svc.from("listings").select("id").in("broker_id", ids);
    if (error) return [];
    return ((data ?? []) as { id: string }[]).map((r) => r.id);
  } catch {
    return [];
  }
}

let listingCache: { at: number; ids: string[] } | null = null;

/** demoListingIds(), cached like getDemoAccounts (public routes call it per request). */
async function cachedDemoListingIds(svc: SupabaseClient): Promise<string[]> {
  if (listingCache && Date.now() - listingCache.at < CACHE_MS) return listingCache.ids;
  const ids = await demoListingIds(svc);
  listingCache = { at: Date.now(), ids };
  return ids;
}

/**
 * M2: is this the demo's listing? Public routes (inquiry, slideshow view /
 * event, download log) answer their normal success for it but store, email
 * and push nothing. No demo account (or the table missing) → false, with no
 * listings query.
 */
export async function isDemoListing(svc: SupabaseClient, listingId: string | null | undefined): Promise<boolean> {
  if (!listingId) return false;
  const rows = await getDemoAccounts(svc);
  if (rows.length === 0) return false;
  if (rows.some((r) => r.listing_id === listingId)) return true;
  return (await cachedDemoListingIds(svc)).indexOf(listingId) >= 0;
}

/** M2: is this broker id the demo account? (Website leads, inquiries.) */
export async function isDemoBroker(svc: SupabaseClient, brokerId: string | null | undefined): Promise<boolean> {
  if (!brokerId) return false;
  return (await demoUserIds(svc)).indexOf(brokerId) >= 0;
}

/** Forget the cached rows (the demo jobs call this after writing). */
export function forgetDemoAccounts(): void {
  cache = null;
  listingCache = null;
}
