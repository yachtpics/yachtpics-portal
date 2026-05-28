import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ListingRow from "./_components/ListingRow";

export default async function ListingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const isAssistant = profile?.role === "assistant";

  let listings: {
    id: string;
    vessel_name: string | null;
    vessel_type: string | null;
    year: number | null;
    length_ft: number | null;
    location: string | null;
    status: string;
    updated_at: string;
    broker_name?: string | null;
    slideshow_slug?: string | null;
    slideshow_published?: boolean | null;
  }[] = [];

  if (isAssistant) {
    // Fetch all broker IDs this assistant is linked to
    const { data: links } = await supabase
      .from("broker_assistants")
      .select("broker_id, profiles:broker_id(first_name, last_name, display_email)")
      .eq("assistant_id", user.id);

    const brokerIds = (links ?? []).map((l) => l.broker_id as string);

    if (brokerIds.length > 0) {
      const { data: allListings } = await supabase
        .from("listings")
        .select("id, vessel_name, vessel_type, year, length_ft, location, status, updated_at, slideshow_slug, slideshow_published, broker_id, profiles:broker_id(first_name, last_name, display_email)")
        .in("broker_id", brokerIds)
        .order("updated_at", { ascending: false });

      listings = (allListings ?? []).map((l) => {
        const p = (l.profiles as unknown as { first_name: string | null; last_name: string | null; display_email: string | null } | null);
        const brokerName = p?.first_name
          ? `${p.first_name} ${p.last_name ?? ""}`.trim()
          : p?.display_email ?? null;
        return { ...l, broker_name: brokerName };
      });
    }
  } else {
    const { data } = await supabase
      .from("listings")
      .select("id, vessel_name, vessel_type, year, length_ft, location, status, updated_at, slideshow_slug, slideshow_published")
      .eq("broker_id", user.id)
      .order("updated_at", { ascending: false });
    listings = data ?? [];
  }

  const active = listings.filter((l) => l.status === "active");
  const archived = listings.filter((l) => l.status !== "active");

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isAssistant ? "Listings" : "My Listings"}
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            {isAssistant
              ? "Listings across all brokers you assist."
              : "View your photos, toggle visibility, and reorder your gallery."}
          </p>
        </div>
        <Link
          href="/dashboard/listings/new"
          className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
        >
          + New Listing
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
          <p className="text-gray-400 text-sm">No listings yet.</p>
          <p className="text-gray-400 text-sm mt-1">
            {isAssistant
              ? "Listings will appear here once a broker you assist has active listings."
              : "Click '+ New Listing' to upload your own photos, or listings will appear here after a YachtPics shoot."}
          </p>
        </div>
      ) : (
        <>
          {/* Active */}
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Active ({active.length})
            </h2>
            {active.length === 0 ? (
              <p className="text-gray-400 text-sm">No active listings.</p>
            ) : (
              <div className="space-y-3">
                {active.map((listing) => (
                  <ListingRow key={listing.id} listing={listing} showBroker={isAssistant} />
                ))}
              </div>
            )}
          </div>

          {/* Archived / Sold */}
          {archived.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Archived / Sold ({archived.length})
              </h2>
              <div className="space-y-3">
                {archived.map((listing) => (
                  <ListingRow key={listing.id} listing={listing} showBroker={isAssistant} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
