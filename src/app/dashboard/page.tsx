import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import HelpTip from "@/components/HelpTip";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, role")
    .eq("id", user.id)
    .single();

  const isAssistant = profile?.role === "assistant";
  const firstName = profile?.first_name ?? "there";

  // ── Assistant dashboard ──────────────────────────────────────────────────
  if (isAssistant) {
    const { data: links } = await supabase
      .from("broker_assistants")
      .select("broker_id, profiles:broker_id(first_name, last_name, display_email)")
      .eq("assistant_id", user.id);

    const brokers = (links ?? []).map((l) => {
      const p = (l.profiles as unknown as { first_name: string | null; last_name: string | null; display_email: string | null } | null);
      return {
        id: l.broker_id as string,
        name: p?.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : p?.display_email ?? "Broker",
      };
    });

    // Fetch recent listings across all linked brokers
    const brokerIds = brokers.map((b) => b.id);
    const { data: recentListings } = brokerIds.length > 0
      ? await supabase
          .from("listings")
          .select("id, vessel_name, location, status, broker_id")
          .in("broker_id", brokerIds)
          .order("updated_at", { ascending: false })
          .limit(5)
      : { data: [] };

    const brokerMap = Object.fromEntries(brokers.map((b) => [b.id, b.name]));

    return (
      <div className="px-6 py-8 max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Welcome back, {firstName}</h1>
          <p className="text-gray-500 mt-1 text-sm">
            You&apos;re assisting {brokers.length} broker{brokers.length !== 1 ? "s" : ""}.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">Brokers</p>
            <p className="text-3xl font-bold text-gray-900">{brokers.length}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">Active Listings</p>
            <p className="text-3xl font-bold text-gray-900">
              {recentListings?.filter((l) => l.status === "active").length ?? 0}
            </p>
          </div>
        </div>

        <Link href="/dashboard/listings" className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] hover:shadow-sm transition-all mb-6">
          <div className="text-2xl mb-2">&#128674;</div>
          <h3 className="font-semibold text-gray-900 mb-1">Listings</h3>
          <p className="text-gray-500 text-sm">View and manage listings across all your brokers.</p>
          <span className="text-[#c49a35] text-sm font-medium mt-3 inline-block">View listings &rarr;</span>
        </Link>

        <div className="bg-white border border-gray-200 rounded-xl">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent Listings</h2>
          </div>
          {recentListings && recentListings.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {recentListings.map((listing) => (
                <li key={listing.id}>
                  <Link href={`/dashboard/listings/${listing.id}`} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors block">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{listing.vessel_name ?? "Untitled vessel"}</p>
                      <p className="text-xs text-[#c49a35] mt-0.5">{brokerMap[listing.broker_id] ?? "—"}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{listing.location ?? ""}</p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      listing.status === "active" ? "bg-green-50 text-green-700"
                      : listing.status === "sold" ? "bg-blue-50 text-blue-700"
                      : "bg-gray-100 text-gray-500"
                    }`}>{listing.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">
              No listings yet across your brokers.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Broker dashboard ─────────────────────────────────────────────────────
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

  const { data: brokerDetails } = await supabase
    .from("broker_details")
    .select("brokerage_name, logo_url")
    .eq("id", user.id)
    .single();

  const activeListings = listings?.filter((l) => l.status === "active").length ?? 0;

  const trialDaysLeft = subscription?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null;

  const isNewAccount = (!listings || listings.length === 0) && !brokerDetails?.logo_url;

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Welcome back, {firstName}</h1>
        <p className="text-gray-500 mt-1 text-sm">Manage your listings and create buyer presentations.</p>
      </div>

      {isNewAccount && (
        <div className="bg-[#050b14] rounded-xl px-6 py-5 mb-6">
          <p className="text-white font-semibold text-sm mb-1">Get set up in 3 steps</p>
          <p className="text-gray-400 text-xs mb-4">Complete these before your first shoot delivery.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link href="/dashboard/profile" className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-3 transition-colors block">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold text-[#d4a843] bg-[#d4a843]/20 w-5 h-5 rounded-full flex items-center justify-center shrink-0">1</span>
                <p className="text-white text-xs font-semibold">Complete your profile</p>
              </div>
              <p className="text-gray-400 text-xs leading-relaxed mb-2">Add your contact info and brokerage details.</p>
              <span className="text-[#d4a843] text-xs font-medium">Go to Profile</span>
            </Link>
            <Link href="/dashboard/profile" className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-3 transition-colors block">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold text-[#d4a843] bg-[#d4a843]/20 w-5 h-5 rounded-full flex items-center justify-center shrink-0">2</span>
                <p className="text-white text-xs font-semibold">Upload your logo</p>
              </div>
              <p className="text-gray-400 text-xs leading-relaxed mb-2">It appears in every client slideshow footer.</p>
              <span className="text-[#d4a843] text-xs font-medium">Upload Logo</span>
            </Link>
            <Link href="/dashboard/billing" className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-3 transition-colors block">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold text-[#d4a843] bg-[#d4a843]/20 w-5 h-5 rounded-full flex items-center justify-center shrink-0">3</span>
                <p className="text-white text-xs font-semibold">Choose a plan</p>
              </div>
              <p className="text-gray-400 text-xs leading-relaxed mb-2">Unlock the slideshow builder. Free 30-day trial.</p>
              <span className="text-[#d4a843] text-xs font-medium">View Plans</span>
            </Link>
          </div>
        </div>
      )}

      {subscription?.status === "trialing" && trialDaysLeft !== null && (
        <div className="bg-[#d4a843]/10 border border-[#d4a843]/30 rounded-xl px-5 py-4 mb-6 flex items-center justify-between">
          <div>
            <p className="text-[#b08c2a] font-medium text-sm">
              {trialDaysLeft > 0
                ? `Your free trial ends in ${trialDaysLeft} day${trialDaysLeft !== 1 ? "s" : ""}.`
                : "Your free trial has ended."}
            </p>
            <p className="text-gray-500 text-xs mt-0.5">Upgrade to keep building slideshows and sharing listings.</p>
          </div>
          <Link href="/dashboard/billing" className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap">
            Upgrade
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Active Listings</p>
            <HelpTip text="Listings marked Active are live and shareable with clients." position="below" />
          </div>
          <p className="text-3xl font-bold text-gray-900">{activeListings}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Total Shoots</p>
            <HelpTip text="Your cumulative YachtPics shoot count. New shoots appear in Shoots and Invoices after delivery." position="below" />
          </div>
          <p className="text-3xl font-bold text-gray-900">&mdash;</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Plan</p>
            <HelpTip text="Your current subscription tier. Photo downloads are always free. A paid plan unlocks the slideshow builder." detail="Go to Billing to upgrade or manage your plan." position="below" />
          </div>
          <p className="text-3xl font-bold text-gray-900 capitalize">
            {subscription?.status === "trialing" ? "Trial" : (subscription?.plan ?? "Free")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <Link href="/dashboard/listings" className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] hover:shadow-sm transition-all group">
          <div className="text-2xl mb-2">&#128674;</div>
          <h3 className="font-semibold text-gray-900 mb-1">My Listings</h3>
          <p className="text-gray-500 text-sm">View photos, toggle visibility, and reorder your listing gallery.</p>
          <span className="text-[#c49a35] text-sm font-medium mt-3 inline-block">View listings &rarr;</span>
        </Link>
        <Link href="/dashboard/shoots" className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] hover:shadow-sm transition-all group">
          <div className="text-2xl mb-2">&#128203;</div>
          <h3 className="font-semibold text-gray-900 mb-1">Shoots &amp; Invoices</h3>
          <p className="text-gray-500 text-sm">Track your shoot history and view payment status.</p>
          <span className="text-[#c49a35] text-sm font-medium mt-3 inline-block">View shoots &rarr;</span>
        </Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Listings</h2>
          <Link href="/dashboard/listings" className="text-[#c49a35] hover:text-[#b08c2a] text-sm font-medium transition-colors">View all &rarr;</Link>
        </div>
        {listings && listings.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {listings.map((listing) => (
              <li key={listing.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{listing.vessel_name ?? "Untitled vessel"}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{listing.location ?? "Location TBD"}</p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                  listing.status === "active" ? "bg-green-50 text-green-700"
                  : listing.status === "sold" ? "bg-blue-50 text-blue-700"
                  : "bg-gray-100 text-gray-500"
                }`}>{listing.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm">No listings yet.</p>
            <p className="text-sm mt-1">Upload your own photos or they'll appear here after a YachtPics shoot.</p>
          </div>
        )}
      </div>
    </div>
  );
}
