import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  const supabase = await createClient();

  const serviceSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Pull brokers and assistants
  const [{ data: brokerProfiles }, { data: assistantProfiles }] = await Promise.all([
    supabase.from("profiles").select("id, first_name, last_name, display_email, created_at").eq("role", "broker").order("first_name"),
    supabase.from("profiles").select("id, first_name, last_name, display_email, created_at").eq("role", "assistant").order("first_name"),
  ]);

  // Auth users for last sign-in (service role only)
  const { data: { users: authUsers } } = await serviceSupabase.auth.admin.listUsers({ perPage: 1000 });
  const lastSignInMap = new Map(authUsers.map((u) => [u.id, u.last_sign_in_at ?? null]));

  // Aggregate data
  type ListingRow = { id: string; broker_id: string; slideshow_published: boolean; vessel_name: string | null };

  const [
    { data: listingsRaw },
    { data: sends },
    { data: views },
    { data: brokerAssistants },
    { data: brokerUploadedPhotos },
  ] = await Promise.all([
    serviceSupabase.from("listings").select("id, broker_id, slideshow_published, vessel_name"),
    serviceSupabase.from("client_sends").select("broker_id, sent_by, sent_at"),
    serviceSupabase.from("slideshow_views").select("listing_id, listings!inner(broker_id)"),
    serviceSupabase.from("broker_assistants").select("broker_id, assistant_id"),
    // Photos where uploaded_by is set — admin uploads have uploaded_by = null, broker/assistant uploads have a user ID
    serviceSupabase.from("photos").select("listing_id, uploaded_by").not("uploaded_by", "is", null),
  ]);

  const listings = (listingsRaw ?? []) as ListingRow[];

  // Build a set of all broker and assistant IDs so we can distinguish their uploads from admin uploads
  const brokerAndAssistantIds = new Set([
    ...(brokerProfiles ?? []).map((p) => p.id),
    ...(assistantProfiles ?? []).map((p) => p.id),
  ]);

  // Listing IDs that have at least one broker/assistant-uploaded photo
  const selfUploadListingIds = new Set(
    (brokerUploadedPhotos ?? [])
      .filter((p) => p.uploaded_by && brokerAndAssistantIds.has(p.uploaded_by))
      .map((p) => p.listing_id)
      .filter(Boolean)
  );

  // Build per-broker stats
  const brokerStats = (brokerProfiles ?? []).map((p) => {
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

    // Sends broken down by who actually sent
    const brokerSentCount = mySends.filter((s) => s.sent_by === p.id || s.sent_by === null).length;
    const assistantSentCount = mySends.filter((s) => s.sent_by !== null && s.sent_by !== p.id).length;

    // Listings where a broker or assistant uploaded at least one photo themselves
    const selfUploadListings = myListings.filter((l) => selfUploadListingIds.has(l.id));
    const selfUploadCount = selfUploadListings.length;

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
      brokerSentCount,
      assistantSentCount,
      slideshowViews: myViews.length,
      selfUploadCount,
      selfUploadListings: selfUploadListings.map((l) => ({ id: l.id, name: l.vessel_name ?? "Untitled" })),
      lastSend,
    };
  });

  // Sort by most recently active
  brokerStats.sort((a, b) => {
    const aTime = a.lastSignIn ? new Date(a.lastSignIn).getTime() : 0;
    const bTime = b.lastSignIn ? new Date(b.lastSignIn).getTime() : 0;
    return bTime - aTime;
  });

  // Build per-assistant stats
  const assistantStats = (assistantProfiles ?? []).map((p) => {
    const lastSignIn = lastSignInMap.get(p.id) ?? null;
    const daysSinceLogin = lastSignIn
      ? Math.floor((Date.now() - new Date(lastSignIn).getTime()) / 86400000)
      : null;
    const mySends = (sends ?? []).filter((s) => s.sent_by === p.id);
    const linkedBrokerIds = (brokerAssistants ?? [])
      .filter((ba) => ba.assistant_id === p.id)
      .map((ba) => ba.broker_id);
    const linkedBrokerNames = linkedBrokerIds.map((bid) => {
      const bp = (brokerProfiles ?? []).find((b) => b.id === bid);
      return bp?.first_name ? `${bp.first_name} ${bp.last_name ?? ""}`.trim() : bp?.display_email ?? "Unknown";
    });

    return {
      id: p.id,
      name: p.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : p.display_email ?? "—",
      email: p.display_email ?? "—",
      joinedAt: p.created_at,
      lastSignIn,
      daysSinceLogin,
      sendCount: mySends.length,
      linkedBrokers: linkedBrokerNames,
    };
  });

  assistantStats.sort((a, b) => {
    const aTime = a.lastSignIn ? new Date(a.lastSignIn).getTime() : 0;
    const bTime = b.lastSignIn ? new Date(b.lastSignIn).getTime() : 0;
    return bTime - aTime;
  });

  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  }

  function activityBadge(days: number | null) {
    if (days === null) return <span className="text-xs text-ink-400">Never</span>;
    if (days <= 7) return <span className="text-xs font-medium text-success-600 bg-success-50 px-2 py-0.5 rounded-full">Active</span>;
    if (days <= 30) return <span className="text-xs font-medium text-warn-700 bg-warn-50 px-2 py-0.5 rounded-full tabular-nums">{days}d ago</span>;
    return <span className="text-xs font-medium text-ink-500 bg-ink-100 px-2 py-0.5 rounded-full tabular-nums">{days}d ago</span>;
  }

  // Platform totals
  const totalListings = brokerStats.reduce((s, b) => s + b.listingCount, 0);
  const totalSlideshows = brokerStats.reduce((s, b) => s + b.publishedSlideshows, 0);
  const totalEmails = brokerStats.reduce((s, b) => s + b.emailsSent, 0);
  const totalSelfUploads = brokerStats.reduce((s, b) => s + b.selfUploadCount, 0);
  const activeThisWeek = brokerStats.filter((b) => b.daysSinceLogin !== null && b.daysSinceLogin <= 7).length;
  const activeAssistantsThisWeek = assistantStats.filter((a) => a.daysSinceLogin !== null && a.daysSinceLogin <= 7).length;

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-display text-ink-900">Metrics</h1>
        <p className="text-ink-500 mt-1 text-sm">Platform activity across brokers and assistants.</p>
      </div>

      {/* Platform totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {[
          { label: "Brokers", value: brokerStats.length },
          { label: "Active This Week", value: activeThisWeek },
          { label: "Total Listings", value: totalListings },
          { label: "Live Slideshows", value: totalSlideshows },
          { label: "Emails Sent", value: totalEmails },
          { label: "Broker Uploads", value: totalSelfUploads, note: "Broker-uploaded photos" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-hairline rounded-card shadow-elev-1 p-4">
            <p className="label-caps">{stat.label}</p>
            <p className="text-2xl font-light tabular-nums text-ink-900 mt-1">{stat.value}</p>
            {stat.note && <p className="text-xs text-ink-400 mt-0.5">{stat.note}</p>}
          </div>
        ))}
      </div>

      {/* Per-broker table */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-hairline">
          <h2 className="text-h2 text-ink-900">Broker Activity</h2>
          <p className="text-xs text-ink-500 mt-0.5">Sorted by most recently active. Sends column split by who sent — broker vs assistant.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline bg-ink-50">
                <th className="text-left px-6 py-3 label-caps">Broker</th>
                <th className="text-left px-4 py-3 label-caps">Last Login</th>
                <th className="text-center px-4 py-3 label-caps">Listings</th>
                <th className="text-center px-4 py-3 label-caps">Broker Upload</th>
                <th className="text-center px-4 py-3 label-caps">Slideshows</th>
                <th className="text-center px-4 py-3 label-caps">Views</th>
                <th className="text-center px-4 py-3 label-caps">Sends</th>
                <th className="text-left px-4 py-3 label-caps">Last Send</th>
                <th className="text-left px-4 py-3 label-caps">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {brokerStats.map((b) => (
                <tr key={b.id} className="hover:bg-ink-50 transition-colors duration-fast ease-quiet">
                  <td className="px-6 py-4">
                    <a href={`/admin/brokers/${b.id}`} className="font-medium text-ink-900 hover:text-accent-700 transition-colors duration-fast ease-quiet">
                      {b.name}
                    </a>
                    <p className="text-xs text-ink-400 mt-0.5">{b.email}</p>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-1">
                      {activityBadge(b.daysSinceLogin)}
                      <span className="text-xs text-ink-400 tabular-nums">{fmtDate(b.lastSignIn)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="font-medium text-ink-900 tabular-nums">{b.listingCount}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    {b.selfUploadCount === 0 ? (
                      <span className="font-medium text-sm text-ink-300">—</span>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <span className="font-semibold text-sm text-warn-700 tabular-nums">{b.selfUploadCount}</span>
                        <div className="flex flex-col gap-0.5">
                          {b.selfUploadListings.map((l) => (
                            <a key={l.id} href={`/admin/listings/${l.id}`} className="text-xs text-warn-700 hover:text-warn-800 hover:underline transition-colors duration-fast ease-quiet leading-tight">
                              {l.name}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`font-medium tabular-nums ${b.publishedSlideshows > 0 ? "text-success-600" : "text-ink-300"}`}>
                      {b.publishedSlideshows}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`font-medium tabular-nums ${b.slideshowViews > 0 ? "text-accent-700" : "text-ink-300"}`}>
                      {b.slideshowViews}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    {b.emailsSent === 0 ? (
                      <span className="text-ink-300 font-medium tabular-nums">0</span>
                    ) : (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-semibold text-ink-900 tabular-nums">{b.emailsSent}</span>
                        {b.assistantSentCount > 0 && (
                          <span className="text-xs text-ink-400 tabular-nums">
                            {b.brokerSentCount}b / {b.assistantSentCount}a
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 text-xs text-ink-400 tabular-nums">{fmtDate(b.lastSend)}</td>
                  <td className="px-4 py-4 text-xs text-ink-400 tabular-nums">{fmtDate(b.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {brokerStats.length === 0 && (
            <div className="py-12 text-center text-ink-400 text-sm">No brokers yet.</div>
          )}
        </div>
      </div>

      {/* Assistant activity table */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden">
        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between">
          <div>
            <h2 className="text-h2 text-ink-900">Assistant Activity</h2>
            <p className="text-xs text-ink-500 mt-0.5">
              {assistantStats.length} assistant{assistantStats.length !== 1 ? "s" : ""} · {activeAssistantsThisWeek} active this week
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline bg-ink-50">
                <th className="text-left px-6 py-3 label-caps">Assistant</th>
                <th className="text-left px-4 py-3 label-caps">Last Login</th>
                <th className="text-center px-4 py-3 label-caps">Sends</th>
                <th className="text-left px-4 py-3 label-caps">Linked Brokers</th>
                <th className="text-left px-4 py-3 label-caps">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {assistantStats.map((a) => (
                <tr key={a.id} className="hover:bg-ink-50 transition-colors duration-fast ease-quiet">
                  <td className="px-6 py-4">
                    <a href={`/admin/assistants/${a.id}`} className="font-medium text-ink-900 hover:text-accent-700 transition-colors duration-fast ease-quiet">
                      {a.name}
                    </a>
                    <p className="text-xs text-ink-400 mt-0.5">{a.email}</p>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-1">
                      {activityBadge(a.daysSinceLogin)}
                      <span className="text-xs text-ink-400 tabular-nums">{fmtDate(a.lastSignIn)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`font-medium tabular-nums ${a.sendCount > 0 ? "text-ink-900" : "text-ink-300"}`}>
                      {a.sendCount}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-xs text-ink-500">
                    {a.linkedBrokers.length === 0 ? "—" : a.linkedBrokers.join(", ")}
                  </td>
                  <td className="px-4 py-4 text-xs text-ink-400 tabular-nums">{fmtDate(a.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {assistantStats.length === 0 && (
            <div className="py-12 text-center text-ink-400 text-sm">No assistants yet.</div>
          )}
        </div>
      </div>

    </div>
  );
}
        