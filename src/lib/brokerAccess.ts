import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessStatus, type AccessStatus } from "@/lib/subscriptionAccess";

/** True when a brokerage's office plan is currently paying or trialing. */
export function officePlanActive(
  office: { subscription_status: string | null } | null
): boolean {
  return office?.subscription_status === "active" || office?.subscription_status === "trialing";
}

/**
 * A broker is unlocked if THEIR OWN plan is active/trialing, OR their brokerage
 * carries an active Office plan. Use a service-role client so RLS never blocks.
 */
export async function getEffectiveAccessStatus(
  service: SupabaseClient,
  brokerId: string
): Promise<{ status: AccessStatus; trialEndsAt: string | null; officeCovered: boolean }> {
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

  return { status: own, trialEndsAt: ownSub?.trial_ends_at ?? null, officeCovered: false };
}
