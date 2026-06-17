import { createClient as createServiceClient } from "@supabase/supabase-js";
import Link from "next/link";
import { PLANS } from "@/lib/plans";
import { getAccessStatus } from "@/lib/subscriptionAccess";

export const dynamic = "force-dynamic";

const GB = 1024 * 1024 * 1024;
const INCLUDED_GB = 100;

function money(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export default async function AdminPage() {
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [
    { data: brokers },
    { data: subs },
    { count: listingCount },
    { data: pendingShoots },
    { data: storageRows },
    { count: views30 },
    { count: sends30 },
    { data: recentShoots },
  ] = await Promise.all([
    service.from("profiles").select("id").eq("role", "broker"),
    service.from("subscriptions").select("broker_id, status, stripe_subscription_id, stripe_price_id, trial_ends_at"),
    service.from("listings").select("*", { count: "exact", head: true }),
    service.from("shoots").select("amount_cents").eq("payment_status", "pending"),
    service.rpc("storage_usage"),
    service.from("slideshow_views").select("*", { count: "exact", head: true }).gte("viewed_at", since30),
    service.from("client_sends").select("*", { count: "exact", head: true }).gte("sent_at", since30),
    service.from("shoots")
      .select("id, shoot_date, amount_cents, payment_status, profiles:broker_id(first_name, last_name), listings:listing_id(vessel_name)")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  // ---- Revenue + subscription mix ----
  const priceById = new Map(PLANS.map((p) => [p.priceId, p.price]));
  const subByBroker = new Map((subs ?? []).map((s) => [s.broker_id as string, s]));

  let paying = 0;
  let mrr = 0;
  let onTrial = 0;
  let expiringSoon = 0;
  let expired = 0;

  for (const b of brokers ?? []) {
    const sub = subByBroker.get(b.id) ?? null;
    const isPaid = sub && (sub.status === "active" || (sub.status === "trialing" && sub.stripe_subscription_id));
    if (isPaid) {
      paying++;
      mrr += priceById.get(sub!.stripe_price_id as string) ?? 0;
      continue;
    }
    const status = getAccessStatus(
      sub ? { status: sub.status, stripe_subscription_id: sub.stripe_subscription_id, trial_ends_at: sub.trial_ends_at } : null
    );
    if (status === "trial_active") onTrial++;
    else if (status === "trial_expiring") { onTrial++; expiringSoon++; }
    else if (status === "trial_expired") expired++;
  }

  const brokerCount = (brokers ?? []).length;

  // ---- Storage ----
  const usedBytes = ((storageRows ?? []) as { bytes: number }[]).reduce((sum, r) => sum + (r.bytes ?? 0), 0);
  const usedGB = usedBytes / GB;
  const storagePct = Math.min(100, (usedGB / INCLUDED_GB) * 100);

  // ---- Pending invoice revenue ----
  const pendingCents = (pendingShoots ?? []).reduce((sum, s) => sum + (s.amount_cents ?? 0), 0);
  const pendingCount = (pendingShoots ?? []).length;

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Business Pulse</h1>
        <p className="text-gray-500 mt-1 text-sm">How YachtPics Portal is doing today, at a glance.</p>
      </div>

      {/* Revenue + conversion */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="bg-[#050b14] text-white rounded-xl p-5">
          <p className="text-gray-400 text-xs font-medium uppercase tracking-wide">Monthly Recurring</p>
          <p className="text-3xl font-bold mt-1">{money(mrr)}</p>
          <p className="text-gray-400 text-xs mt-1">{paying} paying {paying === 1 ? "broker" : "brokers"}</p>
        </div>
        <Link href="/admin/trials" className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] transition-colors">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">On Trial</p>
          <p className="text-3xl font-bold text-blue-700 mt-1">{onTrial}</p>
          <p className="text-gray-400 text-xs mt-1">your conversion pipeline</p>
        </Link>
        <Link href="/admin/trials" className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] transition-colors">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Expiring Soon</p>
          <p className={`text-3xl font-bold mt-1 ${expiringSoon > 0 ? "text-amber-600" : "text-gray-900"}`}>{expiringSoon}</p>
          <p className="text-gray-400 text-xs mt-1">{expired} expired, not subscribed</p>
        </Link>
        <Link href="/admin/shoots" className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] transition-colors">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Unpaid Invoices</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{money(Math.round(pendingCents / 100))}</p>
          <p className="text-gray-400 text-xs mt-1">{pendingCount} pending</p>
        </Link>
      </div>

      {/* Operational + engagement */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Link href="/admin/brokers" className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] transition-colors">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Brokers</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{brokerCount}</p>
        </Link>
        <Link href="/admin/listings" className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] transition-colors">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Listings</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{listingCount ?? 0}</p>
        </Link>
        <Link href="/admin/metrics" className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] transition-colors">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Buyer Views (30d)</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{views30 ?? 0}</p>
          <p className="text-gray-400 text-xs mt-1">{sends30 ?? 0} sent to clients</p>
        </Link>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Storage</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{usedGB.toFixed(1)}<span className="text-base font-medium text-gray-400"> / {INCLUDED_GB} GB</span></p>
          <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${storagePct > 85 ? "bg-red-500" : storagePct > 60 ? "bg-amber-500" : "bg-[#d4a843]"}`} style={{ width: `${storagePct}%` }} />
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 mt-8">
        <Link href="/admin/listings/new" className="bg-[#050b14] hover:bg-[#0a1628] text-white rounded-xl p-5 transition-colors">
          <div className="text-2xl mb-2">➕</div>
          <h3 className="font-semibold mb-1">New Listing</h3>
          <p className="text-gray-400 text-sm">Create a listing and upload photos for a broker.</p>
        </Link>
        <Link href="/admin/shoots/new" className="bg-[#050b14] hover:bg-[#0a1628] text-white rounded-xl p-5 transition-colors">
          <div className="text-2xl mb-2">📄</div>
          <h3 className="font-semibold mb-1">New Invoice</h3>
          <p className="text-gray-400 text-sm">Log a shoot and create an invoice for a broker.</p>
        </Link>
      </div>

      {/* Recent shoots */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Shoots</h2>
          <Link href="/admin/shoots" className="text-[#c49a35] hover:text-[#b08c2a] text-sm font-medium">View all →</Link>
        </div>
        {recentShoots && recentShoots.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {recentShoots.map((shoot) => {
              const brokerArr = shoot.profiles as { first_name: string | null; last_name: string | null }[] | null;
              const broker = Array.isArray(brokerArr) ? brokerArr[0] : brokerArr;
              const listingArr = shoot.listings as { vessel_name: string | null }[] | null;
              const listing = Array.isArray(listingArr) ? listingArr[0] : listingArr;
              const amount = shoot.amount_cents
                ? `$${(shoot.amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                : "—";
              return (
                <li key={shoot.id} className="px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {broker ? `${broker.first_name ?? ""} ${broker.last_name ?? ""}`.trim() : "Unknown broker"}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{listing?.vessel_name ?? "No vessel"}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-sm font-medium text-gray-900">{amount}</p>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      shoot.payment_status === "paid" ? "bg-green-50 text-green-700"
                      : shoot.payment_status === "cancelled" ? "bg-gray-100 text-gray-500"
                      : "bg-yellow-50 text-yellow-700"
                    }`}>
                      {shoot.payment_status}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-center py-10 text-gray-400 text-sm">No shoots yet.</div>
        )}
      </div>
    </div>
  );
}
