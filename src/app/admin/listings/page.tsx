import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function AdminListingsPage() {
  const supabase = await createClient();

  const { data: listings } = await supabase
    .from("listings")
    .select(`
      id, vessel_name, vessel_type, year, length_ft, location, status, updated_at,
      profiles:broker_id(first_name, last_name)
    `)
    .order("updated_at", { ascending: false });

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Listings</h1>
          <p className="text-gray-500 mt-1 text-sm">{listings?.length ?? 0} total listings.</p>
        </div>
        <Link
          href="/admin/listings/new"
          className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
        >
          + New Listing
        </Link>
      </div>

      {(!listings || listings.length === 0) ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
          <p className="text-gray-400 text-sm">No listings yet.</p>
          <Link href="/admin/listings/new" className="inline-block mt-4 text-[#c49a35] text-sm font-medium">
            Create the first one →
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Vessel</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Broker</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Location</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {listings.map((listing) => {
                const brokerArr = listing.profiles as { first_name: string | null; last_name: string | null }[] | null;
                const broker = Array.isArray(brokerArr) ? brokerArr[0] : brokerArr;
                return (
                  <tr key={listing.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">{listing.vessel_name ?? "Untitled"}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {[listing.year, listing.vessel_type, listing.length_ft ? `${listing.length_ft}′` : null].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-gray-500 hidden sm:table-cell">
                      {broker?.first_name ? `${broker.first_name} ${broker.last_name ?? ""}`.trim() : "—"}
                    </td>
                    <td className="px-6 py-4 text-gray-500 hidden md:table-cell">{listing.location ?? "—"}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        listing.status === "active" ? "bg-green-50 text-green-700"
                        : listing.status === "sold" ? "bg-blue-50 text-blue-700"
                        : "bg-gray-100 text-gray-500"
                      }`}>
                        {listing.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/admin/listings/${listing.id}`} className="text-[#c49a35] hover:text-[#b08c2a] text-xs font-medium transition-colors">
                        Manage →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
