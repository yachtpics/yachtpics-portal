import { requireAdminPage } from "@/lib/requireAdminPage";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import AdminListingsBrowser from "./_components/AdminListingsBrowser";
import { ypShareLive, type YpShareRow } from "@/lib/ypShare";

export default async function AdminListingsPage() {
  // Role check lives in the page, not only the layout — see requireAdminPage.
  // It runs alongside the read (which goes through the signed-in user's RLS,
  // so a non-admin gets nothing and is redirected anyway) rather than as an
  // extra round trip in front of it.
  const supabase = await createClient();

  const [, { data: listingsRaw }, ypRes] = await Promise.all([
    requireAdminPage(),
    supabase
      .from("listings")
      .select(`
      id, broker_id, vessel_name, vessel_type, year, length_ft, location, status, updated_at, make, model, in_showcase, showcase_opt_out,
      profiles:broker_id(first_name, last_name)
    `)
      .order("updated_at", { ascending: false }),
    // YachtPics share link (Nov 1): read on its own so a missing column
    // (migration 20261101b not applied) just leaves the indicator off.
    supabase
      .from("listings")
      .select("id, slideshow_published, slideshow_slug, yp_share_enabled, yp_share_token")
      .eq("slideshow_published", true),
  ]);
  const ypLive = new Set<string>(
    ypRes.error ? [] : ((ypRes.data ?? []) as (YpShareRow & { id: string })[]).filter((r) => ypShareLive(r)).map((r) => r.id)
  );

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
      in_showcase: (l.in_showcase ?? false) as boolean,
      showcase_opt_out: (l.showcase_opt_out ?? false) as boolean,
      yp_link: ypLive.has(l.id as string),
    };
  });

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-display text-ink-900">All Listings</h1>
          <p className="text-ink-500 mt-1 text-sm">{listings.length} total listings.</p>
        </div>
        <Link
          href="/admin/listings/new"
          className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          + New Listing
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-16 text-center">
          <p className="text-ink-400 text-sm">No listings yet.</p>
          <Link href="/admin/listings/new" className="inline-block mt-4 text-accent-700 text-sm font-medium">
            Create the first one →
          </Link>
        </div>
      ) : (
        <AdminListingsBrowser listings={listings} />
      )}
    </div>
  );
}
