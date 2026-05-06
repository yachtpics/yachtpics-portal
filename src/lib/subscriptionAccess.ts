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
