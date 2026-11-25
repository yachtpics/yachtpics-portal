import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessStatus, hasAccess, trialDaysFor, type AccessStatus, type SubRow } from "@/lib/subscriptionAccess";

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
 * REFINED the same day (Charlie: "the first five she starts using the tools
 * on"): the admin's plan covers only as many office boats as its range
 * (Starter 5, Growth 10, Pro 20, Elite unlimited), per BOAT, claimed the
 * first time the admin (or her assistant) uses a paid tool on it. Her own
 * active boats use slots first. Rule, slots and copy:
 * src/lib/officeCoverSlots.ts (table office_cover_slots, migration
 * 20261125b). Until that migration is applied: every office boat unlocked.
 *
 * Switch the whole rule off here: false = exactly the old (pre-68a46e1)
 * behaviour.
 * ------------------------------------------------------------------ */
export const OFFICE_ADMIN_PLAN_COVERS_OFFICE = true;

// Tests only (scripts/office_cover_slots_check.ts): flip the rule without
// editing the constant. Production code never calls the setter.
let ruleOverrideForTests: boolean | null = null;
/** The switch as code should read it: OFFICE_ADMIN_PLAN_COVERS_OFFICE. */
export function officeAdminRuleOn(): boolean {
  return ruleOverrideForTests ?? OFFICE_ADMIN_PLAN_COVERS_OFFICE;
}
export function __setOfficeAdminRuleForTests(on: boolean | null) {
  ruleOverrideForTests = on;
}

/**
 * Owner decision (Charlie Clark, Nov 25 2026, 2:56 PM): counter and message
 * only — "maybe a counter is a better idea so they know where they are and
 * when they need to upgrade". The admin's plan never STOPS anyone: every
 * active boat of a covered broker is unlocked, the Portal counts a boat the
 * first time anyone uses a paid tool on it, and over the plan's range the
 * admin sees a note suggesting the plan that fits (src/lib/officeCoverSlots.ts).
 * Set true to restore the hard cap built in 7169d73 (first N boats only,
 * AVAILABLE / FULL states, refusals).
 */
export const OFFICE_COVER_ENFORCE_LIMIT = false;

let enforceOverrideForTests: boolean | null = null;
/** The hard-cap switch as code should read it: OFFICE_COVER_ENFORCE_LIMIT. */
export function officeCoverEnforceOn(): boolean {
  return enforceOverrideForTests ?? OFFICE_COVER_ENFORCE_LIMIT;
}
export function __setOfficeCoverEnforceForTests(on: boolean | null) {
  enforceOverrideForTests = on;
}

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
  if (!officeAdminRuleOn() || brokerageIds.length === 0) return out;
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
 * Is this broker covered by a paying office admin of their brokerage (the
 * broker's own plan, the Office plan and Reel Service are checked by the
 * caller first)? Since the slots refinement (Nov 25 2026, later —
 * src/lib/officeCoverSlots.ts) that means: one of their boats holds a slot of
 * that admin's plan, or the admin's plan has a free slot and the broker has
 * an active boat. Before migration 20261125b is applied: any paying admin
 * (68a46e1). Null when not covered.
 */
export async function officeAdminCoverFor(
  service: SupabaseClient,
  brokerId: string,
  brokerageId: string | null | undefined,
  officeName: string | null = null
): Promise<OfficeAdminCover | null> {
  if (!officeAdminRuleOn() || !brokerageId) return null;
  // Loaded on demand: officeCoverSlots imports this module.
  const { brokerSlotCover } = await import("@/lib/officeCoverSlots");
  const cover = await brokerSlotCover(service, brokerId, brokerageId, officeName);
  return cover ? { adminId: cover.adminId, adminName: cover.adminName, officeName: cover.officeName } : null;
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
 * BROKER-LEVEL answer (dashboard tiles, nav badge, trial emails, audiences).
 * A broker is unlocked if THEIR OWN plan is active/trialing, OR their brokerage
 * carries an active Office plan, OR they pay for the Reel Service on at least
 * one boat (Starter-level access, `reelServiceCovered`), OR a paying office
 * admin of their brokerage covers them (`officeAdminCovered` — since the slots
 * refinement: one of their boats holds a slot or a slot is free for them).
 * Gates on ONE listing use getListingAccess (src/lib/officeCoverSlots.ts):
 * an office admin's plan covers boats, not brokers.
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
  let office: { subscription_status: string | null; name?: string | null } | null = null;
  if (prof?.brokerage_id) {
    const { data } = await service
      .from("brokerages")
      .select("subscription_status, name")
      .eq("id", prof.brokerage_id)
      .single();
    office = (data as { subscription_status: string | null; name?: string | null } | null) ?? null;
    if (officePlanActive(office)) {
      return { status: "active", trialEndsAt: ownSub?.trial_ends_at ?? null, trialDays, officeCovered: true };
    }
  }

  if (await reelServiceGivesAccess(service, brokerId)) {
    return { status: "active", trialEndsAt: ownSub?.trial_ends_at ?? null, trialDays, officeCovered: false, reelServiceCovered: true };
  }

  // Broker level: covered when one of their boats holds a paying office
  // admin's slot, or a slot is free for them (officeAdminCoverFor). Gates that
  // know their listing use getListingAccess (officeCoverSlots.ts) instead.
  // A broker still on their own running trial is on their own access (their
  // boats need no slot), so they keep the trial status and its banner.
  if (prof?.brokerage_id && !hasAccess(own)) {
    const cover = await officeAdminCoverFor(service, brokerId, prof.brokerage_id, office?.name ?? null);
    if (cover) {
      return { status: "active", trialEndsAt: ownSub?.trial_ends_at ?? null, trialDays, officeCovered: false, officeAdminCovered: true, officeAdminCover: cover };
    }
  }

  return { status: own, trialEndsAt: ownSub?.trial_ends_at ?? null, trialDays, officeCovered: false };
}
