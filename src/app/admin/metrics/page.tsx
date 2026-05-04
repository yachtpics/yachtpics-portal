import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  const supabase = await createClient();

  const serviceSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Pull all brokers
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, display_email, created_at")
    .eq("role", "broker")
    .order("first_name");

  // Auth users for last sign-in (service role only)
  const { data: { users: authUsers } } = await serviceSupabase.auth.admin.listUsers({ perPage: 1000 });
  const lastSignInMap = new Map(authUsers.map((u) => [u.id, u.last_sign_in_at ?? null]));

  // Aggregate metrics per broker
  const [
    { data: listings },
    { data: sends },
    { data: views },
    { data: shoots },
  ] = await Promise.all([
    serviceSupabase.from("listings").select("broker_id, slideshow_published"),
    serviceSupabase.from("client_sends").select("broker_id, sent_at"),
    serviceSupabase.from("slideshow_views").select("listing_id, listings!inner(broker_id)"),
    serviceSupabase.from("shoots").select("broker_id, payment_status"),
  ]);

  // Build per-broker stats
  const brokerStats = (profiles ?? []).map((p) => {
    const myListings = (listings ?? []).filter((l) => l.broker_id === p.id);
    const mySends = (sends ?? []).filter((s) => s.broker_id === p.id);
    const myViews = (views ?? []).filter((v) => {
      const listing = v.listings as { broker_id: string } | { broker_id: string }[] | null;
      const brokerId = Array.isArray(listing) ? listing[0]?.broker_id : listing?.broker_id;
      return brokerId === p.id;
    });
    const lastSend = mySends.length > 0
      ? mySends.sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())[0].sent_at
      : null;
    const lastSignIn = lastSignInMap.get(p.id) ?? null;
    const daysSinceLogin = lastSignIn
      ? Math.floor((Date.now() - new Date(lastSignIn).getTime()) / 86400000)
      : null;

    return {
      id: p.id,
      name: p.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : p.display_email ?? "—",
      email: p.display_email ?? "—",
      joinedAt: p.created_at,
      lastSignIn,
      daysSinceLogin,
      listingCount: myListings.length,
      publishedSlideshows: myListings.filter((l) => l.slideshow_published).length,
      emailsSent: mySends.length,
      slideshowViews: myViews.length,
      lastSend,
    };
  });

  // Sort by most recently active
  brokerStats.sort((a, b) => {
    const aTime = a.lastSignIn ? new Date(a.lastSignIn).getTime() : 0;
    const bTime = b.lastSignIn ? new Date(b.lastSignIn).getTime() : 0;
    return bTime - aTime;
  });

  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function activityBadge(days: number | null) {
    if (days === null) return <span className="text-xs text-gray-300">Never</span>;
    if (days <= 7) return <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Active</span>;
    if (days <= 30) return <span className="text-xs font-medium text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">{days}d ago</span>;
    return <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{days}d ago</span>;
  }

  // Platform totals
  const totalListings = brokerStats.reduce((s, b) => s + b.listingCount, 0);
  const totalSlideshows = brokerStats.reduce((s, b) => s + b.publishedSlideshows, 0);
  const totalEmails = brokerStats.reduce((s, b) => s + b.emailsSent, 0);
  const totalViews = brokerStats.reduce((s, b) => s + b.slideshowViews, 0);
  const activeThisWeek = brokerStats.filter((b) => b.daysSinceLogin !== null && b.daysSinceLogin <= 7).length;

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Metrics</h1>
        <p className="text-gray-500 mt-1 text-sm">Broker activity and platform usage.</p>
      </div>

      {/* Platform totals */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
        {[
          { label: "Brokers", value: brokerStats.length },
          { label: "Active This Week", value: activeThisWeek },
          { label: "Total Listings", value: totalListings },
          { label: "Live Slideshows", value: totalSlideshows },
          { label: "Emails Sent", value: totalEmails },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">{stat.label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Per-broker table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Broker Activity</h2>
          <p className="text-xs text-gray-400 mt-0.5">Sorted by most recently active. Slideshow views tracked since feature launch.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Broker</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Login</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Listings</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Slideshows</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Emails Sent</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Slideshow Views</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {brokerStats.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <a href={`/admin/brokers/${b.id}`} className="font-medium text-gray-900 hover:text-[#c49a35] transition-colors">
                      {b.name}
                    </a>
                    <p className="text-xs text-gray-400 mt-0.5">{b.email}</p>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-1">
                      {activityBadge(b.daysSinceLogin)}
                      <span className="text-xs text-gray-400">{fmtDate(b.lastSignIn)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="font-medium text-gray-900">{b.listingCount}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`font-medium ${b.publishedSlideshows > 0 ? "text-green-600" : "text-gray-300"}`}>
                      {b.publishedSlideshows}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`font-medium ${b.emailsSent > 0 ? "text-gray-900" : "text-gray-300"}`}>
                      {b.emailsSent}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`font-medium ${b.slideshowViews > 0 ? "text-[#c49a35]" : "text-gray-300"}`}>
                      {b.slideshowViews}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-xs text-gray-400">{fmtDate(b.lastSend)}</td>
                  <td className="px-4 py-4 text-xs text-gray-400">{fmtDate(b.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {brokerStats.length === 0 && (
            <div className="py-12 text-center text-gray-400 text-sm">No brokers yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
