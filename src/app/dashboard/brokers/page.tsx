import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui";
import ConnectBrokerPanel from "./_components/ConnectBrokerPanel";
import InviteBrokerPanel from "./_components/InviteBrokerPanel";

export default async function MyBrokersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "assistant") redirect("/dashboard");

  // All brokers this assistant can access (explicit links + everyone in their brokerage)
  const { data: brokerIdRows } = await supabase.rpc("accessible_broker_ids");
  const brokerIds = ((brokerIdRows ?? []) as { broker_id: string }[]).map((r) => r.broker_id);

  const [{ data: brokerProfiles }, { data: details }, { data: allListings }, { data: allBrokers }] = await Promise.all([
    brokerIds.length > 0
      ? supabase.from("profiles").select("id, first_name, last_name, display_email, phone").in("id", brokerIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null; display_email: string | null; phone: string | null }[] }),
    brokerIds.length > 0
      ? supabase.from("broker_details").select("id, brokerage_name, brokerage_website").in("id", brokerIds)
      : Promise.resolve({ data: [] }),
    brokerIds.length > 0
      ? supabase.from("listings").select("id, vessel_name, location, status, broker_id").in("broker_id", brokerIds).order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from("profiles").select("id, first_name, last_name, display_email").eq("role", "broker").order("last_name", { ascending: true }),
  ]);

  const detailsMap = Object.fromEntries((details ?? []).map((d) => [d.id, d]));
  const linkedIds = new Set(brokerIds);

  type ListingRow = { id: string; vessel_name: string | null; location: string | null; status: string; broker_id: string };
  const listingsByBroker: Record<string, ListingRow[]> = {};
  for (const listing of allListings ?? []) {
    if (!listingsByBroker[listing.broker_id]) listingsByBroker[listing.broker_id] = [];
    listingsByBroker[listing.broker_id]!.push(listing as ListingRow);
  }

  const brokers = (brokerProfiles ?? []).map((p) => {
    const d = detailsMap[p.id];
    return {
      id: p.id,
      name: p.first_name ? (p.first_name + " " + (p.last_name ?? "")).trim() : p.display_email ?? "Broker",
      email: p.display_email ?? null,
      phone: p.phone ?? null,
      brokerage_name: d?.brokerage_name ?? null,
      brokerage_website: d?.brokerage_website ?? null,
      listings: listingsByBroker[p.id] ?? [],
    };
  });

  // Available brokers = all brokers not yet linked to this assistant
  const availableBrokers = (allBrokers ?? [])
    .filter((b) => !linkedIds.has(b.id))
    .map((b) => ({
      id: b.id,
      name: b.first_name ? (b.first_name + " " + (b.last_name ?? "")).trim() : b.display_email ?? "Broker",
      email: b.display_email ?? null,
    }));

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-8 pb-6 border-b border-hairline">
        <h1 className="text-display text-ink-900">My Brokers</h1>
        <p className="text-ink-500 mt-1 text-sm">
          The brokers you currently assist on YachtPics Portal.
        </p>
      </div>

      {brokers.length === 0 ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-16 text-center">
          <p className="text-ink-500 text-sm">No brokers linked yet.</p>
          <p className="text-ink-400 text-xs mt-1">Use the form below to connect to a broker.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {brokers.map((broker) => (
            <div key={broker.id} className="bg-white border border-hairline rounded-card shadow-elev-1 px-6 py-5">
              <p className="text-base font-semibold text-ink-900">{broker.name}</p>
              {broker.brokerage_name && (
                <p className="text-sm text-accent-700 mt-0.5">{broker.brokerage_name}</p>
              )}
              <div className="mt-4 space-y-2">
                {broker.email && (
                  <div className="flex items-center gap-2">
                    <span className="label-caps w-12">Email</span>
                    <a href={"mailto:" + broker.email} className="text-sm text-ink-700 hover:text-accent-700 transition-colors duration-fast">{broker.email}</a>
                  </div>
                )}
                {broker.phone && (
                  <div className="flex items-center gap-2">
                    <span className="label-caps w-12">Phone</span>
                    <a href={"tel:" + broker.phone} className="text-sm text-ink-700 hover:text-accent-700 transition-colors duration-fast">{broker.phone}</a>
                  </div>
                )}
                {broker.brokerage_website && (
                  <div className="flex items-center gap-2">
                    <span className="label-caps w-12">Web</span>
                    <a href={broker.brokerage_website} target="_blank" rel="noopener noreferrer" className="text-sm text-ink-700 hover:text-accent-700 transition-colors duration-fast">
                      {broker.brokerage_website.replace(/^https?:\/\//, "")}
                    </a>
                  </div>
                )}
              </div>

              {/* Listings toggle */}
              <details className="mt-5 group">
                <summary className="cursor-pointer list-none flex items-center justify-between text-sm font-medium text-ink-600 hover:text-ink-900 transition-colors duration-fast select-none">
                  <span>View Listings ({broker.listings.length})</span>
                  <span className="text-ink-400 group-open:rotate-180 transition-transform duration-base ease-quiet inline-block">▾</span>
                </summary>
                <div className="mt-3 border-t border-hairline pt-3 space-y-2">
                  {broker.listings.length === 0 ? (
                    <p className="text-sm text-ink-400">No listings yet.</p>
                  ) : (
                    broker.listings.map((listing) => (
                      <Link
                        key={listing.id}
                        href={"/dashboard/listings/" + listing.id}
                        className="flex items-center justify-between px-3 py-2.5 rounded-ctl hover:bg-ink-50 transition-colors duration-fast group/row"
                      >
                        <div>
                          <p className="text-sm font-medium text-ink-900 group-hover/row:text-accent-700 transition-colors duration-fast">
                            {listing.vessel_name ?? "Untitled vessel"}
                          </p>
                          {listing.location && (
                            <p className="text-xs text-ink-500 mt-0.5">{listing.location}</p>
                          )}
                        </div>
                        <Badge tone={
                          listing.status === "active" ? "success"
                          : listing.status === "sold" ? "info"
                          : "neutral"
                        }>
                          {listing.status}
                        </Badge>
                      </Link>
                    ))
                  )}
                </div>
              </details>
            </div>
          ))}
        </div>
      )}

      <ConnectBrokerPanel availableBrokers={availableBrokers} />
      <InviteBrokerPanel />
    </div>
  );
}
