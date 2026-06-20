import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ListingsBrowser from "./_components/ListingsBrowser";

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

  type ListingItem = {
    id: string;
    vessel_name: string | null;
    vessel_type: string | null;
    year: number | null;
    length_ft: number | null;
    location: string | null;
    status: string;
    updated_at: string;
    make?: string | null;
    model?: string | null;
    broker_id?: string | null;
    broker_name?: string | null;
    is_shared?: boolean | null;
    slideshow_slug?: string | null;
    slideshow_published?: boolean | null;
  };

  // Row-level security decides what this user can see: their own boats, the
  // boats of brokers they assist / manage, plus any listing individually shared
  // into their brokerage. We just read listings and let RLS do the filtering.
  const { data } = await supabase
    .from("listings")
    .select("id, vessel_name, vessel_type, year, length_ft, location, status, updated_at, make, model, is_shared, slideshow_slug, slideshow_published, broker_id, profiles:broker_id(first_name, last_name, display_email)")
    .order("updated_at", { ascending: false });

  const listings: ListingItem[] = (data ?? []).map((l) => {
    const p = (l.profiles as unknown as { first_name: string | null; last_name: string | null; display_email: string | null } | null);
    const brokerName = p?.first_name
      ? `${p.first_name} ${p.last_name ?? ""}`.trim()
      : p?.display_email ?? null;
    return { ...l, broker_name: brokerName };
  });

  // Which of these listings is the current user a co-broker on (vs. owner)?
  const { data: coRows } = await supabase
    .from("listing_co_brokers")
    .select("listing_id")
    .eq("broker_id", user.id);
  const coBrokerIds = new Set((coRows ?? []).map((r) => r.listing_id as string));

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
        <ListingsBrowser
          listings={listings}
          currentUserId={user.id}
          coBrokerIds={Array.from(coBrokerIds)}
        />
      )}
    </div>
  );
}
