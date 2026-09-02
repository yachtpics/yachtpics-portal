import Link from "next/link";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  getAccessStatus,
  isStripePaid,
  isComped,
  trialDaysRemaining,
  type AccessStatus,
} from "@/lib/subscriptionAccess";
import { planForPriceId } from "@/lib/plans";

export const dynamic = "force-dynamic";

type Broker = {
  id: string;
  name: string;
  email: string | null;
  status: AccessStatus;
  daysLeft: number | null;
  trialEndsAt: string | null;
  neverLoggedIn: boolean;
  /** Stripe is really billing this broker. */
  paid: boolean;
  /** Unlocked by hand — staff, demo or comped. */
  comped: boolean;
  planName: string | null;
  planPrice: number | null;
  renewsAt: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

export default async function AdminTrialsPage() {
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [{ data: profiles }, { data: subs }] = await Promise.all([
    service.from("profiles").select("id, first_name, last_name, display_email, welcomed_at").eq("role", "broker"),
    service
      .from("subscriptions")
      .select(
        "broker_id, status, trial_ends_at, stripe_subscription_id, stripe_price_id, current_period_end"
      ),
  ]);

  const subByBroker = new Map(
    (subs ?? []).map((s) => [s.broker_id as string, s])
  );

  const brokers: Broker[] = (profiles ?? []).map((p) => {
    const sub = subByBroker.get(p.id) ?? null;
    const status = getAccessStatus(
      sub ? { status: sub.status, stripe_subscription_id: sub.stripe_subscription_id, trial_ends_at: sub.trial_ends_at } : null
    );
    const plan = planForPriceId(sub?.stripe_price_id ?? null);
    return {
      id: p.id,
      name: p.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : (p.display_email ?? "Broker"),
      email: p.display_email ?? null,
      status,
      daysLeft: sub?.trial_ends_at ? trialDaysRemaining(sub.trial_ends_at) : null,
      trialEndsAt: sub?.trial_ends_at ?? null,
      neverLoggedIn: !p.welcomed_at,
      paid: isStripePaid(sub),
      comped: isComped(sub),
      planName: plan?.name ?? null,
      planPrice: plan?.price ?? null,
      renewsAt: sub?.current_period_end ?? null,
    };
  });

  // Buckets, ordered by how much they need attention.
  //
  // "Paying" means Stripe is really billing them. Accounts unlocked by hand
  // (staff, demo, comped) also carry status 'active', so they used to land
  // here and inflate the count — they now get their own section below.
  const expiring = brokers.filter((b) => b.status === "trial_expiring").sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const expired = brokers.filter((b) => b.status === "trial_expired").sort((a, b) => (a.trialEndsAt ?? "").localeCompare(b.trialEndsAt ?? ""));
  const trialing = brokers.filter((b) => b.status === "trial_active").sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const paying = brokers.filter((b) => b.paid).sort((a, b) => (b.planPrice ?? 0) - (a.planPrice ?? 0));
  const comped = brokers.filter((b) => b.comped);
  const notStarted = brokers.filter((b) => b.status === "no_access");

  const mrr = paying.reduce((sum, b) => sum + (b.planPrice ?? 0), 0);

  const sections: { title: string; tone: string; help: string; rows: Broker[]; showDays?: boolean; showEnded?: boolean; showPlan?: boolean }[] = [
    { title: "Expiring soon", tone: "text-warn-700 bg-warn-50 border-warn-200", help: "Trial ends within 5 days — best time to reach out.", rows: expiring, showDays: true },
    { title: "Expired — not subscribed", tone: "text-danger-700 bg-danger-50 border-danger-200", help: "Trial ended without a plan. Win them back.", rows: expired, showEnded: true },
    { title: "On trial", tone: "text-info-700 bg-info-50 border-info-200", help: "Active trial with more than 5 days left.", rows: trialing, showDays: true },
    { title: "Paying", tone: "text-success-700 bg-success-50 border-success-200", help: "Card on file and billing through Stripe.", rows: paying, showPlan: true },
    { title: "Comped", tone: "text-accent-700 bg-accent-50 border-accent-200", help: "Unlocked by hand — staff, demo and test accounts. No billing.", rows: comped },
    { title: "Not started", tone: "text-ink-600 bg-ink-50 border-hairline", help: "Invited but trial hasn't begun (no first login yet).", rows: notStarted },
  ];

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-display text-ink-900">Trials &amp; Conversion</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Where every broker stands. Brokers in the final 3 days and just-lapsed trials are emailed automatically — this is your follow-up call list.
        </p>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {[
          ["Expiring", expiring.length, "text-warn-700"],
          ["Expired", expired.length, "text-danger-700"],
          ["On trial", trialing.length, "text-info-700"],
          ["Paying", paying.length, "text-success-700"],
          ["Comped", comped.length, "text-accent-700"],
          ["Not started", notStarted.length, "text-ink-600"],
        ].map(([label, count, color]) => (
          <div key={label as string} className="bg-white border border-hairline rounded-card shadow-elev-1 px-4 py-3 text-center">
            <p className={`text-2xl font-light tabular-nums ${color}`}>{count as number}</p>
            <p className="text-xs text-ink-500 mt-0.5">{label as string}</p>
          </div>
        ))}
      </div>

      <div className="space-y-8">
        {sections.map((s) => (
          <div key={s.title}>
            <div className="flex items-center gap-3 mb-3">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${s.tone}`}>{s.title} ({s.rows.length})</span>
              <span className="text-xs text-ink-500">{s.help}</span>
              {s.showPlan && mrr > 0 && (
                <span className="text-xs font-medium text-success-700 tabular-nums ml-auto shrink-0">
                  ${mrr.toLocaleString("en-US")}/mo
                </span>
              )}
            </div>
            {s.rows.length === 0 ? (
              <p className="text-sm text-ink-400 pl-1">None.</p>
            ) : (
              <div className="bg-white border border-hairline rounded-card shadow-elev-1 divide-y divide-hairline overflow-hidden">
                {s.rows.map((b) => (
                  <div key={b.id} className="flex items-center justify-between px-4 py-3 gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-900 truncate">{b.name}</p>
                      {b.email && (
                        <a href={`mailto:${b.email}`} className="text-xs text-ink-500 hover:text-accent-700 transition-colors duration-fast ease-quiet">{b.email}</a>
                      )}
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      {s.showDays && b.daysLeft != null && (
                        <span className="text-xs text-ink-500 tabular-nums">{b.daysLeft} {b.daysLeft === 1 ? "day" : "days"} left</span>
                      )}
                      {s.showEnded && (
                        <span className="text-xs text-ink-500 tabular-nums">ended {fmtDate(b.trialEndsAt)}</span>
                      )}
                      {s.showPlan && (
                        <span className="text-xs text-ink-500 tabular-nums text-right">
                          {b.planName ? (
                            <span className="font-medium text-ink-700">
                              {b.planName}, ${b.planPrice}/mo
                            </span>
                          ) : (
                            // Billing in Stripe but the price ID isn't in
                            // src/lib/plans.ts — worth a look if you see this.
                            <span className="font-medium text-warn-700">Unknown plan</span>
                          )}
                          {b.renewsAt && (
                            <span className="block text-ink-400">renews {fmtDate(b.renewsAt)}</span>
                          )}
                        </span>
                      )}
                      <Link href={`/admin/brokers/${b.id}`} className="text-xs font-medium text-accent-700 hover:underline whitespace-nowrap">
                        View →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
