import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function ListingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: listings } = await supabase
    .from("listings")
    .select("id, vessel_name, vessel_type, year, length_ft, location, status, updated_at")
    .eq("broker_id", user.id)
    .order("updated_at", { ascending: false });

  const active = listings?.filter((l) => l.status === "active") ?? [];
  const archived = listings?.filter((l) => l.status !== "active") ?? [];

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Listings</h1>
          <p className="text-gray-500 mt-1 text-sm">
            View your photos, toggle visibility, and reorder your gallery.
          </p>
        </div>
      </div>

      {(!listings || listings.length === 0) ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
          <p className="text-gray-400 text-sm">No listings yet.</p>
          <p className="text-gray-400 text-sm mt-1">
            Your listings will appear here once YachtPics delivers your photos.
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
                  <ListingRow key={listing.id} listing={listing} />
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
                  <ListingRow key={listing.id} listing={listing} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ListingRow({ listing }: { listing: {
  id: string;
  vessel_name: string | null;
  vessel_type: string | null;
  year: number | null;
  length_ft: number | null;
  location: string | null;
  status: string;
  updated_at: string;
}}) {
  const updated = new Date(listing.updated_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-6 py-4 flex items-center justify-between hover:border-[#d4a843] transition-colors">
      <div>
        <p className="text-sm font-semibold text-gray-900">
          {listing.vessel_name ?? "Untitled vessel"}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          {[
            listing.year,
            listing.vessel_type,
            listing.length_ft ? `${listing.length_ft}′` : null,
            listing.location,
          ].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex items-center gap-4">
        <p className="text-xs text-gray-400 hidden sm:block">Updated {updated}</p>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
          listing.status === "active"
            ? "bg-green-50 text-green-700"
            : listing.status === "sold"
            ? "bg-blue-50 text-blue-700"
            : "bg-gray-100 text-gray-500"
        }`}>
          {listing.status}
        </span>
      </div>
    </div>
  );
}
