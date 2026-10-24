import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessStatus, type AccessStatus } from "@/lib/subscriptionAccess";

/** True when a brokerage's office plan is currently paying or trialing. */
export function officePlanActive(
  office: { subscription_status: string | null } | null
): boolean {
  return office?.subscription_status === "active" || office?.subscription_status === "trialing";
}

/**
 * Reel Service (Oct 24): a broker with at least one paid boat still running
 * (billing_status active or past_due, not ended) gets Starter-level Portal
 * access while it lasts. Comped boats don't count. False on any error (e.g.
 * migration 20261024 not applied yet).
 */
export async function reelServiceGivesAccess(service: SupabaseClient, brokerId: string): Promise<boolean> {
  try {
    const { count, error } = await service
      .from("reel_service_listings")
      .select("listing_id", { count: "exact", head: true })
      .eq("broker_id", brokerId)
      .is("ended_at", null)
      .in("billing_status", ["active", "past_due"]); // = REEL_SERVICE_PAID_STATUSES (reelService.ts, not imported to keep this light)
    return !error && (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Which of these brokers have a paid Reel Service boat running (active /
 * past_due, not ended). Used where "Your Reels" is shown: a paid boat counts
 * whatever the broker's comped-reels switch says. [] on any error.
 */
export async function paidReelServiceBrokerIds(service: SupabaseClient, brokerIds: string[]): Promise<string[]> {
  if (brokerIds.length === 0) return [];
  try {
    const { data, error } = await service
      .from("reel_service_listings")
      .select("broker_id")
      .in("broker_id", brokerIds)
      .is("ended_at", null)
      .in("billing_status", ["active", "past_due"]);
    if (error) return [];
    return ((data ?? []) as { broker_id: string }[]).map((r) => r.broker_id).filter((b, i, a) => a.indexOf(b) === i);
  } catch {
    return [];
  }
}

/**
 * A broker is unlocked if THEIR OWN plan is active/trialing, OR their brokerage
 * carries an active Office plan, OR they pay for the Reel Service on at least
 * one boat (Starter-level access, `reelServiceCovered`). Use a service-role
 * client so RLS never blocks.
 */
export async function getEffectiveAccessStatus(
  service: SupabaseClient,
  brokerId: string
): Promise<{ status: AccessStatus; trialEndsAt: string | null; officeCovered: boolean; reelServiceCovered?: boolean }> {
  const { data: ownSub } = await service
    .from("subscriptions")
    .select("status, stripe_subscription_id, trial_ends_at")
    .eq("broker_id", brokerId)
    .single();

  const own = getAccessStatus(ownSub ?? null);
  if (own === "active") {
    return { status: "active", trialEndsAt: ownSub?.trial_ends_at ?? null, officeCovered: false };
  }

  const { data: prof } = await service.from("profiles").select("brokerage_id").eq("id", brokerId).single();
  if (prof?.brokerage_id) {
    const { data: office } = await service
      .from("brokerages")
      .select("subscription_status")
      .eq("id", prof.brokerage_id)
      .single();
    if (officePlanActive(office ?? null)) {
      return { status: "active", trialEndsAt: ownSub?.trial_ends_at ?? null, officeCovered: true };
    }
  }

  if (await reelServiceGivesAccess(service, brokerId)) {
    return { status: "active", trialEndsAt: ownSub?.trial_ends_at ?? null, officeCovered: false, reelServiceCovered: true };
  }

  return { status: own, trialEndsAt: ownSub?.trial_ends_at ?? null, officeCovered: false };
}
