import { createClient as createServiceClient } from "@supabase/supabase-js";

type EventRow = {
  user_id: string;
  kind: "page_open" | "boat_view" | "contact_click";
  listing_id: string | null;
  detail: string | null;
  created_at: string;
};

function fmt(s: string): string {
  return new Date(s).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "America/New_York", timeZoneName: "short",
  });
}

// Usage metrics for the Recently Photographed page, shown above the admin grid.
// Answers "are brokers/assistants actually using this?" — page opens, boat photo
// views, and contact taps, broken down per person and by most-viewed boat.
export default async function ShowcaseMetrics() {
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: eventsRaw } = await service
    .from("showcase_events")
    .select("user_id, kind, listing_id, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(5000);
  const events = (eventsRaw ?? []) as EventRow[];

  const userIds = Array.from(new Set(events.map((e) => e.user_id)));
  const listingIds = Array.from(new Set(events.map((e) => e.listing_id).filter(Boolean))) as string[];

  const NONE = "00000000-0000-0000-0000-000000000000";
  const [{ data: profs }, { data: lsts }] = await Promise.all([
    service.from("profiles").select("id, first_name, last_name, display_email").in("id", userIds.length ? userIds : [NONE]),
    service.from("listings").select("id, vessel_name").in("id", listingIds.length ? listingIds : [NONE]),
  ]);
  const profById = new Map((profs ?? []).map((p) => [p.id, p]));
  const nameById = new Map((lsts ?? []).map((l) => [l.id, l.vessel_name ?? "Untitled"]));

  const pageOpens = events.filter((e) => e.kind === "page_open").length;
  const boatViews = events.filter((e) => e.kind === "boat_view").length;
  const contacts = events.filter((e) => e.kind === "contact_click");
  const phoneTaps = contacts.filter((e) => e.detail === "phone").length;
  const emailTaps = contacts.filter((e) => e.detail === "email").length;

  // Per-user rollup (events are newest-first, so first-seen = last active).
  type UserAgg = { name: string; email: string | null; last: string; opens: number; views: number; contacts: number };
  const byUser = new Map<string, UserAgg>();
  for (const e of events) {
    let u = byUser.get(e.user_id);
    if (!u) {
      const p = profById.get(e.user_id);
      const name = p?.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : (p?.display_email ?? "Unknown user");
      u = { name, email: p?.display_email ?? null, last: e.created_at, opens: 0, views: 0, contacts: 0 };
      byUser.set(e.user_id, u);
    }
    if (e.kind === "page_open") u.opens += 1;
    else if (e.kind === "boat_view") u.views += 1;
    else u.contacts += 1;
  }
  const users = Array.from(byUser.values()).sort((a, b) => (a.last < b.last ? 1 : -1));

  // Most-viewed boats.
  const boatCount = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "boat_view" && e.listing_id) boatCount.set(e.listing_id, (boatCount.get(e.listing_id) ?? 0) + 1);
  }
  const topBoats = Array.from(boatCount.entries())
    .map(([id, n]) => ({ name: nameById.get(id) ?? "Untitled", n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);

  const Stat = ({ value, label }: { value: number; label: string }) => (
    <div className="text-center">
      <p className="text-2xl font-light tabular-nums text-ink-900">{value}</p>
      <p className="text-[11px] text-ink-500 mt-0.5">{label}</p>
    </div>
  );

  return (
    <div className="px-6 pt-8 max-w-6xl mx-auto">
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="label-caps">Usage</h2>
          <p className="text-[11px] text-ink-400">Brokers &amp; assistants · admin activity excluded</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-4 border-b border-hairline">
          <Stat value={users.length} label="Active people" />
          <Stat value={pageOpens} label="Page opens" />
          <Stat value={boatViews} label="Boat photo views" />
          <Stat value={contacts.length} label="Contact taps" />
        </div>

        {events.length === 0 ? (
          <p className="text-sm text-ink-400 mt-4">No activity yet. Metrics will appear here as brokers and assistants use the page.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-6 mt-4">
            {/* Who's using it */}
            <div>
              <h3 className="text-[11px] font-medium text-ink-500 uppercase tracking-wide mb-2">Who&rsquo;s using it</h3>
              <div className="space-y-1.5">
                {users.slice(0, 12).map((u, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <span className="text-ink-800 font-medium truncate">{u.name}</span>
                      <span className="block text-[11px] text-ink-400 tabular-nums">Last active {fmt(u.last)}</span>
                    </div>
                    <div className="shrink-0 text-[11px] text-ink-500 tabular-nums text-right">
                      {u.opens} open{u.opens === 1 ? "" : "s"} · {u.views} view{u.views === 1 ? "" : "s"}
                      {u.contacts > 0 && <> · {u.contacts} contact{u.contacts === 1 ? "" : "s"}</>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Most-viewed boats */}
            <div>
              <h3 className="text-[11px] font-medium text-ink-500 uppercase tracking-wide mb-2">Most-viewed boats</h3>
              {topBoats.length === 0 ? (
                <p className="text-sm text-ink-400">No boat photo views yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {topBoats.map((b, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-ink-800 truncate">{b.name}</span>
                      <span className="shrink-0 text-ink-500 tabular-nums">{b.n} view{b.n === 1 ? "" : "s"}</span>
                    </div>
                  ))}
                </div>
              )}
              {contacts.length > 0 && (
                <p className="text-[11px] text-ink-400 mt-3 tabular-nums">Contact taps: {phoneTaps} phone · {emailTaps} email</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
