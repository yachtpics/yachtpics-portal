import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", user.id)
    .single();

  const { data: listings } = await supabase
    .from("listings")
    .select("id, vessel_name, location, status, updated_at")
    .eq("broker_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(5);

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan, status, trial_ends_at")
    .eq("broker_id", user.id)
    .single();

  const firstName = profile?.first_name ?? "there";

  const activeListings = listings?.filter((l) => l.status === "active").length ?? 0;

  const trialDaysLeft = subscription?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {firstName}
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Manage your listings and create buyer presentations.
        </p>
      </div>

      {/* Trial banner */}
      {subscription?.status === "trialing" && trialDaysLeft !== null && (
        <div className="bg-[#d4a843]/10 border border-[#d4a843]/30 rounded-xl px-5 py-4 mb-6 flex items-center justify-between">
          <div>
            <p className="text-[#b08c2a] font-medium text-sm">
              {trialDaysLeft > 0
                ? `Your free trial ends in ${trialDaysLeft} day${trialDaysLeft !== 1 ? "s" : ""}.`
                : "Your free trial has ended."}
            </p>
            <p className="text-gray-500 text-xs mt-0.5">
              Upgrade to keep building slideshows and sharing listings.
            </p>
          </div>
          <Link
            href="/dashboard/billing"
            className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
          >
            Upgrade
          </Link>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Active Listings</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{activeListings}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Total Shoots</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">—</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Plan</p>
          <p className="text-3xl font-bold text-gray-900 mt-1 capitalize">
            {subscription?.status === "trialing" ? "Trial" : (subscription?.plan ?? "Free")}
          </p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <Link
          href="/dashboard/listings"
          className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] hover:shadow-sm transition-all group"
        >
          <div className="text-2xl mb-2">🚢</div>
          <h3 className="font-semibold text-gray-900 mb-1">My Listings</h3>
          <p className="text-gray-500 text-sm">View photos, toggle visibility, and reorder your listing gallery.</p>
          <span className="text-[#c49a35] text-sm font-medium mt-3 inline-block">View listings →</span>
        </Link>
        <Link
          href="/dashboard/shoots"
          className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] hover:shadow-sm transition-all group"
        >
          <div className="text-2xl mb-2">📋</div>
          <h3 className="font-semibold text-gray-900 mb-1">Shoots & Invoices</h3>
          <p className="text-gray-500 text-sm">Track your shoot history and view payment status.</p>
          <span className="text-[#c49a35] text-sm font-medium mt-3 inline-block">View shoots →</span>
        </Link>
      </div>

      {/* Recent listings */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Listings</h2>
          <Link href="/dashboard/listings" className="text-[#c49a35] hover:text-[#b08c2a] text-sm font-medium transition-colors">
            View all →
          </Link>
        </div>

        {listings && listings.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {listings.map((listing) => (
              <li key={listing.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {listing.vessel_name ?? "Untitled vessel"}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{listing.location ?? "Location TBD"}</p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                  listing.status === "active"
                    ? "bg-green-50 text-green-700"
                    : listing.status === "sold"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-gray-100 text-gray-500"
                }`}>
                  {listing.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm">No listings yet.</p>
            <p className="text-sm mt-1">Your YachtPics shoot photos will appear here after delivery.</p>
          </div>
        )}
      </div>
    </div>
  );
}
