import { planForPriceId } from "@/lib/plans";

/**
 * Subscription access logic — single source of truth.
 *
 * AccessStatus values:
 *   'active'          — Stripe subscription is active (paid)
 *   'trial_active'    — DB trial running, > 5 days left
 *   'trial_expiring'  — DB trial running, ≤ 5 days left
 *   'trial_expired'   — Trial ended, no active Stripe subscription
 *   'no_access'       — No subscription row at all
 */

export type AccessStatus =
  | "active"
  | "trial_active"
  | "trial_expiring"
  | "trial_expired"
  | "no_access";

export interface SubRow {
  status: string | null;
  stripe_subscription_id?: string | null;
  trial_ends_at: string | null;
}

export function getAccessStatus(sub: SubRow | null): AccessStatus {
  if (!sub) return "no_access";

  // Paid Stripe subscription
  if (sub.status === "active") return "active";

  // Stripe-managed trial (broker went through checkout, got a trialing Stripe sub)
  if (sub.status === "trialing" && sub.stripe_subscription_id) return "active";

  // DB trial (broker was invited, trigger seeded trial_ends_at)
  if (sub.trial_ends_at) {
    const daysLeft = trialDaysRemaining(sub.trial_ends_at);
    if (daysLeft > 5) return "trial_active";
    if (daysLeft > 0) return "trial_expiring";
    return "trial_expired";
  }

  return "no_access";
}

/* ------------------------------------------------------------------ *
 * Billing helpers — REPORTING ONLY. Never use these to gate features.
 *
 * getAccessStatus()/hasAccess() above answer "what may this broker do?"
 * and deliberately treat a hand-unlocked (comped) account exactly like a
 * paid one, because comped brokers must keep working normally.
 *
 * These two answer a different question: "is Stripe actually charging
 * anyone?" That distinction is what the admin pages need, so that staff
 * and test accounts stop being counted as revenue.
 * ------------------------------------------------------------------ */

export interface BillingSubRow extends SubRow {
  stripe_price_id?: string | null;
  current_period_end?: string | null;
}

/**
 * True only when a real Stripe subscription is attached and live.
 *
 * Note we ignore the `plan` text column entirely — nothing keeps it in
 * sync after checkout, so it can still read "free" for a paying broker.
 * The Stripe fields are the source of truth.
 */
export function isStripePaid(sub: BillingSubRow | null): boolean {
  if (!sub?.stripe_subscription_id) return false;
  return sub.status === "active" || sub.status === "trialing";
}

/** Unlocked by hand — staff, demo or comped. Full access, no billing. */
export function isComped(sub: BillingSubRow | null): boolean {
  if (!sub) return false;
  return sub.status === "active" && !sub.stripe_subscription_id;
}

/**
 * The plan name to show a broker or on an admin screen.
 *
 * Derived from the Stripe price ID rather than the old `subscriptions.plan`
 * text column. That column was written once at signup and never updated
 * again, so a paying broker's own dashboard read "Free". Price ID comes
 * straight from Stripe on every webhook, so it cannot drift.
 */
export function planLabel(sub: BillingSubRow | null): string {
  if (isStripePaid(sub)) {
    return planForPriceId(sub!.stripe_price_id)?.name ?? "Paid";
  }
  if (isComped(sub)) return "Complimentary";
  if (sub?.status === "trialing") return "Trial";
  return "Free";
}

export function trialDaysRemaining(trialEndsAt: string | null): number {
  if (!trialEndsAt) return 0;
  return Math.max(
    0,
    Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000)
  );
}

/** Returns true if the broker can use upload/publish features */
export function hasAccess(status: AccessStatus): boolean {
  return (
    status === "active" ||
    status === "trial_active" ||
    status === "trial_expiring"
  );
}
