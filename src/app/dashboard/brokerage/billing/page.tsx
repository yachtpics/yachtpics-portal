import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BROKERAGE_PLANS, OFFICE_PLAN, TEAM_PLAN, brokeragePlanFitting, type BrokeragePlan } from "@/lib/plans";
import { currentBrokeragePlan } from "@/lib/brokeragePlanServer";
import OfficeBillingActions, { StartPlanButton } from "./_components/OfficeBillingActions";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

export default async function BrokerageBillingPage({ searchParams }: { searchParams: { success?: string; cancelled?: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_brokerage_admin, brokerage_id")
    .eq("id", user.id)
    .single();
  if (!profile?.is_brokerage_admin || !profile.brokerage_id) redirect("/dashboard");

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: brokerage } = await service
    .from("brokerages")
    .select("name, subscription_status, current_period_end, stripe_subscription_id")
    .eq("id", profile.brokerage_id)
    .single();
  const { count: brokerCount } = await service
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("brokerage_id", profile.brokerage_id)
    .eq("role", "broker");

  const status = brokerage?.subscription_status ?? null;
  const active = status === "active" || status === "trialing";
  const subscribed = active || status === "past_due";
  const brokers = brokerCount ?? 0;
  const fits = brokeragePlanFitting(brokers);

  // Which plan (Team / Office): one Stripe lookup, on this page only — there's
  // no plan column. Falls back to Office (src/lib/brokeragePlanServer.ts).
  let plan: BrokeragePlan = OFFICE_PLAN;
  if (subscribed && brokerage?.stripe_subscription_id) {
    plan = (await currentBrokeragePlan(brokerage.stripe_subscription_id as string)).plan;
  }
  const onTeam = plan.id === TEAM_PLAN.id;
  const overage = Math.max(0, brokers - plan.brokerCap);

  // The one plan move this page offers, if any (only while active / trialing).
  let switchTo: { id: string; name: string; price: number; prominent: boolean } | null = null;
  if (active && onTeam && brokers > TEAM_PLAN.brokerCap) {
    switchTo = { id: OFFICE_PLAN.id, name: OFFICE_PLAN.name, price: OFFICE_PLAN.price, prominent: true };
  } else if (active && !onTeam && brokers <= TEAM_PLAN.brokerCap) {
    switchTo = { id: TEAM_PLAN.id, name: TEAM_PLAN.name, price: TEAM_PLAN.price, prominent: false };
  }

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/dashboard/brokerage" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">← Brokerage</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Office Billing</h1>
        <p className="text-gray-500 mt-1 text-sm">One plan covers everyone at {brokerage?.name ?? "your brokerage"}.</p>
      </div>

      {searchParams.success && (
        <div className="mb-6 px-4 py-3 rounded-lg text-sm bg-green-50 border border-green-200 text-green-700">
          You&rsquo;re all set. Your plan is active for your whole team.
        </div>
      )}
      {searchParams.cancelled && (
        <div className="mb-6 px-4 py-3 rounded-lg text-sm bg-gray-50 border border-gray-200 text-gray-600">
          Checkout cancelled — no changes were made.
        </div>
      )}

      {subscribed ? (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">{plan.name} plan</p>
              <p className="text-xs text-gray-500 mt-0.5">{plan.description}</p>
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              status === "active" ? "bg-green-50 text-green-700"
              : status === "trialing" ? "bg-yellow-50 text-yellow-700"
              : "bg-red-50 text-red-700"
            }`}>
              {status === "active" ? "Active" : status === "trialing" ? "Trial" : "Past due"}
            </span>
          </div>

          <div className="mt-4 flex items-baseline gap-1">
            <span className="text-3xl font-bold text-gray-900">${plan.price}</span>
            <span className="text-gray-400 text-sm">/ month, per location</span>
          </div>

          <p className="text-sm text-gray-500 mt-3">
            <span className="font-semibold text-gray-900">{brokers}</span> of {plan.brokerCap} included brokers
            {!onTeam && overage > 0 && <span className="text-amber-600"> · {overage} over the cap — reach out to YachtPics to add seats</span>}.
            {" "}Every broker&rsquo;s assistants and your shared inventory are included.
          </p>
          {onTeam && overage > 0 && (
            <p className="text-sm text-amber-600 mt-2">
              Your office has {brokers} brokers. Team covers {TEAM_PLAN.brokerCap}. Office covers up to {OFFICE_PLAN.brokerCap}.
            </p>
          )}

          {active && brokerage?.current_period_end && (
            <p className="text-xs text-gray-400 mt-1">
              {status === "trialing" ? "Trial ends" : "Renews"} {fmtDate(brokerage.current_period_end)}
            </p>
          )}

          <div className="mt-5">
            <OfficeBillingActions switchTo={switchTo} trialing={status === "trialing"} />
          </div>
        </div>
      ) : (
        <div className="mb-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {BROKERAGE_PLANS.map((p) => {
              const tooMany = brokers > p.brokerCap;
              return (
                <div key={p.id} className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-gray-900">{p.name} plan</p>
                    {fits.id === p.id && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Fits your office</span>
                    )}
                  </div>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-gray-900">${p.price}</span>
                    <span className="text-gray-400 text-sm">/ month, per location</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2 flex-1">{p.description}</p>
                  <div className="mt-5">
                    {p.id === TEAM_PLAN.id && tooMany ? (
                      <>
                        <StartPlanButton planId={p.id} label={`Start the ${p.name} plan — $${p.price}/mo`} disabled />
                        <p className="text-xs text-gray-500 mt-2">Your office has {brokers} brokers. Team covers up to {TEAM_PLAN.brokerCap}.</p>
                      </>
                    ) : (
                      <StartPlanButton planId={p.id} label={`Start the ${p.name} plan — $${p.price}/mo`} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-sm text-gray-500 mt-4">
            Your office has <span className="font-semibold text-gray-900">{brokers}</span> {brokers === 1 ? "broker" : "brokers"}.
            {" "}Every broker&rsquo;s assistants and your shared inventory are included.
            {brokers > OFFICE_PLAN.brokerCap && <span className="text-amber-600"> Office covers {OFFICE_PLAN.brokerCap}. Reach out to YachtPics to add seats.</span>}
          </p>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Individual brokers don&rsquo;t need their own plan while a Team or Office plan is active. They&rsquo;re covered automatically.
      </p>
    </div>
  );
}
