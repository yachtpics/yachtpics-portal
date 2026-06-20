import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import AdminListingsBrowser from "./_components/AdminListingsBrowser";

export default async function AdminListingsPage() {
  const supabase = await createClient();

  const { data: listingsRaw } = await supabase
    .from("listings")
    .select(`
      id, broker_id, vessel_name, vessel_type, year, length_ft, location, status, updated_at, make, model,
      profiles:broker_id(first_name, last_name)
    `)
    .order("updated_at", { ascending: false });

  const listings = (listingsRaw ?? []).map((l) => {
    const b = (Array.isArray(l.profiles) ? l.profiles[0] : l.profiles) as { first_name: string | null; last_name: string | null } | null;
    return {
      id: l.id as string,
      vessel_name: l.vessel_name as string | null,
      vessel_type: l.vessel_type as string | null,
      year: l.year as number | null,
      length_ft: l.length_ft as number | null,
      location: l.location as string | null,
      status: l.status as string,
      broker_id: l.broker_id as string | null,
      broker_name: b?.first_name ? `${b.first_name} ${b.last_name ?? ""}`.trim() : null,
      make: (l.make ?? null) as string | null,
      model: (l.model ?? null) as string | null,
    };
  });

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Listings</h1>
          <p className="text-gray-500 mt-1 text-sm">{listings.length} total listings.</p>
        </div>
        <Link
          href="/admin/listings/new"
          className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
        >
          + New Listing
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
          <p className="text-gray-400 text-sm">No listings yet.</p>
          <Link href="/admin/listings/new" className="inline-block mt-4 text-[#c49a35] text-sm font-medium">
            Create the first one →
          </Link>
        </div>
      ) : (
        <AdminListingsBrowser listings={listings} />
      )}
    </div>
  );
}
