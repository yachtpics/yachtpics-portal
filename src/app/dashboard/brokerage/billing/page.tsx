import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OFFICE_PLAN } from "@/lib/plans";
import OfficeBillingActions from "./_components/OfficeBillingActions";

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
    .select("name, subscription_status, current_period_end")
    .eq("id", profile.brokerage_id)
    .single();
  const { count: brokerCount } = await service
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("brokerage_id", profile.brokerage_id)
    .eq("role", "broker");

  const status = brokerage?.subscription_status ?? null;
  const active = status === "active" || status === "trialing";
  const brokers = brokerCount ?? 0;
  const overage = Math.max(0, brokers - OFFICE_PLAN.brokerCap);

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/dashboard/brokerage" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">← Brokerage</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Office Billing</h1>
        <p className="text-gray-500 mt-1 text-sm">One plan covers everyone at {brokerage?.name ?? "your brokerage"}.</p>
      </div>

      {searchParams.success && (
        <div className="mb-6 px-4 py-3 rounded-lg text-sm bg-green-50 border border-green-200 text-green-700">
          You&rsquo;re all set — the Office plan is active for your whole team.
        </div>
      )}
      {searchParams.cancelled && (
        <div className="mb-6 px-4 py-3 rounded-lg text-sm bg-gray-50 border border-gray-200 text-gray-600">
          Checkout cancelled — no changes were made.
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">{OFFICE_PLAN.name} plan</p>
            <p className="text-xs text-gray-500 mt-0.5">{OFFICE_PLAN.description}</p>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
            status === "active" ? "bg-green-50 text-green-700"
            : status === "trialing" ? "bg-yellow-50 text-yellow-700"
            : status === "past_due" ? "bg-red-50 text-red-700"
            : "bg-gray-100 text-gray-500"
          }`}>
            {status === "active" ? "Active" : status === "trialing" ? "Trial" : status === "past_due" ? "Past due" : "Not subscribed"}
          </span>
        </div>

        <div className="mt-4 flex items-baseline gap-1">
          <span className="text-3xl font-bold text-gray-900">${OFFICE_PLAN.price}</span>
          <span className="text-gray-400 text-sm">/ month, per location</span>
        </div>

        <p className="text-sm text-gray-500 mt-3">
          <span className="font-semibold text-gray-900">{brokers}</span> of {OFFICE_PLAN.brokerCap} included brokers
          {overage > 0 && <span className="text-amber-600"> · {overage} over the cap — reach out to YachtPics to add seats</span>}.
          {" "}Every broker&rsquo;s assistants and your shared inventory are included.
        </p>

        {active && brokerage?.current_period_end && (
          <p className="text-xs text-gray-400 mt-1">
            {status === "trialing" ? "Trial ends" : "Renews"} {fmtDate(brokerage.current_period_end)}
          </p>
        )}

        <div className="mt-5">
          <OfficeBillingActions active={active} />
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Individual brokers don&rsquo;t need their own plan while the Office plan is active — they&rsquo;re all unlocked automatically.
      </p>
    </div>
  );
}
