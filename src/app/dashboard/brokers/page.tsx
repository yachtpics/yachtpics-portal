import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
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

  // Fetch linked broker IDs + profile info
  const { data: links } = await supabase
    .from("broker_assistants")
    .select("broker_id, profiles:broker_id(first_name, last_name, display_email, phone)")
    .eq("assistant_id", user.id);

  const brokerIds = (links ?? []).map((l) => l.broker_id as string);

  // Fetch all brokers + broker_details + listings in parallel
  const [{ data: details }, { data: allListings }, { data: allBrokers }] = await Promise.all([
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

  const brokers = (links ?? []).map((l) => {
    const p = l.profiles as unknown as { first_name: string | null; last_name: string | null; display_email: string | null; phone: string | null } | null;
    const d = detailsMap[l.broker_id as string];
    return {
      id: l.broker_id as string,
      name: p?.first_name ? (p.first_name + " " + (p.last_name ?? "")).trim() : p?.display_email ?? "Broker",
      email: p?.display_email ?? null,
      phone: p?.phone ?? null,
      brokerage_name: d?.brokerage_name ?? null,
      brokerage_website: d?.brokerage_website ?? null,
      listings: listingsByBroker[l.broker_id as string] ?? [],
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
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">My Brokers</h1>
        <p className="text-gray-500 mt-1 text-sm">
          The brokers you currently assist on YachtPics Portal.
        </p>
      </div>

      {brokers.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
          <p className="text-gray-400 text-sm">No brokers linked yet.</p>
          <p className="text-gray-400 text-xs mt-1">Use the form below to connect to a broker.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {brokers.map((broker) => (
            <div key={broker.id} className="bg-white border border-gray-200 rounded-xl px-6 py-5">
              <p className="text-base font-semibold text-gray-900">{broker.name}</p>
              {broker.brokerage_name && (
                <p className="text-sm text-[#c49a35] mt-0.5">{broker.brokerage_name}</p>
              )}
              <div className="mt-4 space-y-2">
                {broker.email && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs w-12">Email</span>
                    <a href={"mailto:" + broker.email} className="text-sm text-gray-700 hover:text-[#c49a35] transition-colors">{broker.email}</a>
                  </div>
                )}
                {broker.phone && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs w-12">Phone</span>
                    <a href={"tel:" + broker.phone} className="text-sm text-gray-700 hover:text-[#c49a35] transition-colors">{broker.phone}</a>
                  </div>
                )}
                {broker.brokerage_website && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs w-12">Web</span>
                    <a href={broker.brokerage_website} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-700 hover:text-[#c49a35] transition-colors">
                      {broker.brokerage_website.replace(/^https?:\/\//, "")}
                    </a>
                  </div>
                )}
              </div>

              {/* Listings toggle */}
              <details className="mt-5 group">
                <summary className="cursor-pointer list-none flex items-center justify-between text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors select-none">
                  <span>View Listings ({broker.listings.length})</span>
                  <span className="text-gray-400 group-open:rotate-180 transition-transform inline-block">▾</span>
                </summary>
                <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                  {broker.listings.length === 0 ? (
                    <p className="text-sm text-gray-400">No listings yet.</p>
                  ) : (
                    broker.listings.map((listing) => (
                      <Link
                        key={listing.id}
                        href={"/dashboard/listings/" + listing.id}
                        className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors group/row"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900 group-hover/row:text-[#c49a35] transition-colors">
                            {listing.vessel_name ?? "Untitled vessel"}
                          </p>
                          {listing.location && (
                            <p className="text-xs text-gray-400 mt-0.5">{listing.location}</p>
                          )}
                        </div>
                        <span className={"text-xs font-medium px-2 py-1 rounded-full " + (
                          listing.status === "active" ? "bg-green-50 text-green-700"
                          : listing.status === "sold" ? "bg-blue-50 text-blue-700"
                          : "bg-gray-100 text-gray-500"
                        )}>
                          {listing.status}
                        </span>
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
