import { createClient as createServiceClient } from "@supabase/supabase-js";
import Link from "next/link";
import { PLANS } from "@/lib/plans";
import { getAccessStatus } from "@/lib/subscriptionAccess";
import RepublishLiveBoats from "./_components/RepublishLiveBoats";
import RetiredPages from "./_components/RetiredPages";

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
    { data: retiredPages },
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
    // Only deactivated pages that STILL have a file on the server need cleanup.
    // Without the has_page filter, a page you'd already deleted kept reappearing
    // here on every refresh.
    service.from("site_pages").select("label, filename").eq("is_active", false).eq("has_page", true).order("label"),
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
        <h1 className="text-display text-ink-900">Business Pulse</h1>
        <p className="text-ink-500 mt-1 text-sm">How YachtPics Portal is doing today, at a glance.</p>
      </div>

      {/* Revenue + conversion */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="bg-ink-950 text-white rounded-card p-5">
          <p className="label-caps-inverse">Monthly Recurring</p>
          <p className="text-3xl font-light tabular-nums mt-1">{money(mrr)}</p>
          <p className="text-ink-400 text-xs mt-1">{paying} paying {paying === 1 ? "broker" : "brokers"}</p>
        </div>
        <Link href="/admin/trials" className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 hover:border-accent-500 transition-colors duration-fast ease-quiet">
          <p className="label-caps">On Trial</p>
          <p className="text-3xl font-light tabular-nums text-info-700 mt-1">{onTrial}</p>
          <p className="text-ink-400 text-xs mt-1">your conversion pipeline</p>
        </Link>
        <Link href="/admin/trials" className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 hover:border-accent-500 transition-colors duration-fast ease-quiet">
          <p className="label-caps">Expiring Soon</p>
          <p className={`text-3xl font-light tabular-nums mt-1 ${expiringSoon > 0 ? "text-warn-700" : "text-ink-900"}`}>{expiringSoon}</p>
          <p className="text-ink-400 text-xs mt-1">{expired} expired, not subscribed</p>
        </Link>
        <Link href="/admin/shoots" className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 hover:border-accent-500 transition-colors duration-fast ease-quiet">
          <p className="label-caps">Unpaid Invoices</p>
          <p className="text-3xl font-light tabular-nums text-ink-900 mt-1">{money(Math.round(pendingCents / 100))}</p>
          <p className="text-ink-400 text-xs mt-1">{pendingCount} pending</p>
        </Link>
      </div>

      {/* Operational + engagement */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Link href="/admin/brokers" className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 hover:border-accent-500 transition-colors duration-fast ease-quiet">
          <p className="label-caps">Brokers</p>
          <p className="text-3xl font-light tabular-nums text-ink-900 mt-1">{brokerCount}</p>
        </Link>
        <Link href="/admin/listings" className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 hover:border-accent-500 transition-colors duration-fast ease-quiet">
          <p className="label-caps">Listings</p>
          <p className="text-3xl font-light tabular-nums text-ink-900 mt-1">{listingCount ?? 0}</p>
        </Link>
        <Link href="/admin/metrics" className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 hover:border-accent-500 transition-colors duration-fast ease-quiet">
          <p className="label-caps">Buyer Views (30d)</p>
          <p className="text-3xl font-light tabular-nums text-ink-900 mt-1">{views30 ?? 0}</p>
          <p className="text-ink-400 text-xs mt-1">{sends30 ?? 0} sent to clients</p>
        </Link>
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
          <p className="label-caps">Storage</p>
          <p className="text-3xl font-light tabular-nums text-ink-900 mt-1">{usedGB.toFixed(1)}<span className="text-base font-medium text-ink-400"> / {INCLUDED_GB} GB</span></p>
          <div className="mt-2 h-1.5 bg-ink-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${storagePct > 85 ? "bg-danger-500" : storagePct > 60 ? "bg-warn-300" : "bg-accent-500"}`} style={{ width: `${storagePct}%` }} />
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 mt-8">
        <Link href="/admin/listings/new" className="bg-ink-950 hover:bg-ink-800 text-white rounded-card p-5 transition-colors duration-fast ease-quiet">
          <div className="text-2xl mb-2">➕</div>
          <h3 className="font-semibold mb-1">New Listing</h3>
          <p className="text-ink-400 text-sm">Create a listing and upload photos for a broker.</p>
        </Link>
        <Link href="/admin/shoots/new" className="bg-ink-950 hover:bg-ink-800 text-white rounded-card p-5 transition-colors duration-fast ease-quiet">
          <div className="text-2xl mb-2">📄</div>
          <h3 className="font-semibold mb-1">New Invoice</h3>
          <p className="text-ink-400 text-sm">Log a shoot and create an invoice for a broker.</p>
        </Link>
      </div>

      {/* Website maintenance */}
      <div className="mb-8 space-y-4">
        <RepublishLiveBoats />
        <RetiredPages pages={(retiredPages ?? []) as { label: string; filename: string }[]} />
      </div>

      {/* Recent shoots */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <h2 className="text-h2 text-ink-900">Recent Shoots</h2>
          <Link href="/admin/shoots" className="text-accent-700 hover:text-accent-800 text-sm font-medium">View all →</Link>
        </div>
        {recentShoots && recentShoots.length > 0 ? (
          <ul className="divide-y divide-hairline">
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
                    <p className="text-sm font-medium text-ink-900">
                      {broker ? `${broker.first_name ?? ""} ${broker.last_name ?? ""}`.trim() : "Unknown broker"}
                    </p>
                    <p className="text-xs text-ink-500 mt-0.5">{listing?.vessel_name ?? "No vessel"}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-sm font-medium text-ink-900 tabular-nums">{amount}</p>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                      shoot.payment_status === "paid" ? "bg-success-50 text-success-700 border-success-200"
                      : shoot.payment_status === "cancelled" ? "bg-ink-100 text-ink-600 border-hairline"
                      : "bg-warn-50 text-warn-700 border-warn-200"
                    }`}>
                      {shoot.payment_status}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-center py-10 text-ink-400 text-sm">No shoots yet.</div>
        )}
      </div>
    </div>
  );
}
