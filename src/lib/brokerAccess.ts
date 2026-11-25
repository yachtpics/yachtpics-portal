import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessStatus, trialDaysFor, type AccessStatus, type SubRow } from "@/lib/subscriptionAccess";

// Trial length by cohort lives in subscriptionAccess.ts (client-safe, used by
// the billing page too); re-exported here so server code can find it with the
// rest of the access rules.
export { trialDaysFor, TRIAL_DAYS, TRIAL_DAYS_LEGACY, TRIAL_CUTOVER } from "@/lib/subscriptionAccess";

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

/* ------------------------------------------------------------------ *
 * Office admin's own plan covers their office (Nov 25 2026).
 *
 * Owner decision (Charlie Clark, Nov 25 2026 — "for now"): when a company
 * (office) admin pays for their OWN Portal plan, that plan unlocks the
 * Portal's paid tools on the listings of the brokers in their own office, so
 * the admin can work on those boats without roadblocks (real case: Kelly
 * Sprigg, SYC Yachts, Starter, working on Steve Sprigg's 13 boats).
 *
 * The unlock is on the LISTING OWNER (like the Office plan): the owner, their
 * assistant, the office admin and the owner's public buyer links all agree.
 * It comes after the owner's own plan and the Office plan, before the Reel
 * Service check. The listing range is a reminder only (listingAllowance.ts).
 *
 * Switch the whole rule off here: false = exactly the old behaviour.
 * ------------------------------------------------------------------ */
export const OFFICE_ADMIN_PLAN_COVERS_OFFICE = true;

/**
 * "A live paid plan" for the office-admin rule: a real Stripe subscription
 * that Stripe is charging right now — status 'active' with a Stripe id (and
 * getAccessStatus agrees). NOT covered by this: a comped account (active, no
 * Stripe id), the in-app free trial, a Stripe 'trialing' subscription (a plan
 * picked during the trial, not charged yet), past_due, canceled.
 */
export function isPayingPlan(sub: SubRow | null | undefined): boolean {
  return !!sub && !!sub.stripe_subscription_id && sub.status === "active" && getAccessStatus(sub) === "active";
}

export type OfficeAdminCover = {
  /** The paying office admin whose plan covers this broker. */
  adminId: string;
  adminName: string;
  /** The brokerage's name, when known. */
  officeName: string | null;
};

type AdminLite = { id: string; name: string };

function displayName(p: { first_name?: string | null; last_name?: string | null }): string {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Your office admin";
}

/**
 * Paying office admins of these brokerages, by brokerage id (two queries).
 * Empty on any error or when the rule is switched off.
 */
export async function payingOfficeAdmins(service: SupabaseClient, brokerageIds: string[]): Promise<Map<string, AdminLite[]>> {
  const out = new Map<string, AdminLite[]>();
  if (!OFFICE_ADMIN_PLAN_COVERS_OFFICE || brokerageIds.length === 0) return out;
  try {
    const { data: admins, error } = await service
      .from("profiles")
      .select("id, first_name, last_name, brokerage_id")
      .in("brokerage_id", brokerageIds)
      .eq("is_brokerage_admin", true);
    if (error || !admins || admins.length === 0) return out;
    const rows = admins as { id: string; first_name: string | null; last_name: string | null; brokerage_id: string | null }[];
    const { data: subs, error: subErr } = await service
      .from("subscriptions")
      .select("broker_id, status, stripe_subscription_id, trial_ends_at")
      .in("broker_id", rows.map((a) => a.id));
    if (subErr || !subs) return out;
    const paying = new Set(
      (subs as (SubRow & { broker_id: string })[]).filter((s) => isPayingPlan(s)).map((s) => s.broker_id)
    );
    rows
      .filter((a) => a.brokerage_id && paying.has(a.id))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)) || a.id.localeCompare(b.id))
      .forEach((a) => {
        const list = out.get(a.brokerage_id as string) ?? [];
        list.push({ id: a.id, name: displayName(a) });
        out.set(a.brokerage_id as string, list);
      });
  } catch {
    return new Map();
  }
  return out;
}

/**
 * Is this broker's office covered by ANOTHER profile in the same brokerage
 * that is an office admin with a paying plan of their own? (The broker's own
 * plan and the Office plan are checked by the caller first.) Null when not.
 */
export async function officeAdminCoverFor(
  service: SupabaseClient,
  brokerId: string,
  brokerageId: string | null | undefined,
  officeName: string | null = null
): Promise<OfficeAdminCover | null> {
  if (!OFFICE_ADMIN_PLAN_COVERS_OFFICE || !brokerageId) return null;
  const admins = (await payingOfficeAdmins(service, [brokerageId])).get(brokerageId) ?? [];
  const admin = admins.find((a) => a.id !== brokerId);
  return admin ? { adminId: admin.id, adminName: admin.name, officeName } : null;
}

export type EffectiveAccess = {
  status: AccessStatus;
  trialEndsAt: string | null;
  trialDays: number;
  officeCovered: boolean;
  reelServiceCovered?: boolean;
  /** Unlocked by a paying office admin's own plan (OFFICE_ADMIN_PLAN_COVERS_OFFICE). */
  officeAdminCovered?: boolean;
  /** Who covers them, for copy ("covered by Kelly Sprigg's plan (SYC Yachts)"). */
  officeAdminCover?: OfficeAdminCover;
};

/**
 * A broker is unlocked if THEIR OWN plan is active/trialing, OR their brokerage
 * carries an active Office plan, OR a paying office admin of their brokerage
 * covers them (`officeAdminCovered`, Nov 25 2026), OR they pay for the Reel
 * Service on at least one boat (Starter-level access, `reelServiceCovered`).
 * Use a service-role client so RLS never blocks.
 */
export async function getEffectiveAccessStatus(
  service: SupabaseClient,
  brokerId: string
): Promise<EffectiveAccess> {
  const { data: ownSub } = await service
    .from("subscriptions")
    .select("status, stripe_subscription_id, trial_ends_at, created_at")
    .eq("broker_id", brokerId)
    .single();
  // This broker's trial length (14 or 30 by cohort) — for "your N-day trial" copy.
  const trialDays = trialDaysFor(ownSub ?? null);

  const own = getAccessStatus(ownSub ?? null);
  if (own === "active") {
    return { status: "active", trialEndsAt: ownSub?.trial_ends_at ?? null, trialDays, officeCovered: false };
  }

  const { data: prof } = await service.from("profiles").select("brokerage_id").eq("id", brokerId).single();
  if (prof?.brokerage_id) {
    const { data: office } = await service
      .from("brokerages")
      .select("subscription_status, name")
      .eq("id", prof.brokerage_id)
      .single();
    if (officePlanActive(office ?? null)) {
      return { status: "active", trialEndsAt: ownSub?.trial_ends_at ?? null, trialDays, officeCovered: true };
    }
    const cover = await officeAdminCoverFor(service, brokerId, prof.brokerage_id, (office as { name?: string | null } | null)?.name ?? null);
    if (cover) {
      return { status: "active", trialEndsAt: ownSub?.trial_ends_at ?? null, trialDays, officeCovered: false, officeAdminCovered: true, officeAdminCover: cover };
    }
  }

  if (await reelServiceGivesAccess(service, brokerId)) {
    return { status: "active", trialEndsAt: ownSub?.trial_ends_at ?? null, trialDays, officeCovered: false, reelServiceCovered: true };
  }

  return { status: own, trialEndsAt: ownSub?.trial_ends_at ?? null, trialDays, officeCovered: false };
}
