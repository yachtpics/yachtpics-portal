import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import Link from "next/link";
import ListingsBrowser from "./_components/ListingsBrowser";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { hasAccess } from "@/lib/subscriptionAccess";

export default async function ListingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Your role, the listings themselves, and which of them you're a co-broker
  // on are three independent reads. Fetched together so the page waits once
  // rather than three times.
  //
  // Row-level security decides what this user can see: their own boats, the
  // boats of brokers they assist / manage, plus any listing individually shared
  // into their brokerage. We just read listings and let RLS do the filtering.
  const [{ data: profile }, { data }, { data: coRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single(),
    supabase
      .from("listings")
      .select("id, vessel_name, vessel_type, year, length_ft, location, status, updated_at, make, model, is_shared, slideshow_slug, slideshow_published, broker_id, profiles:broker_id(first_name, last_name, display_email)")
      .order("updated_at", { ascending: false }),
    supabase
      .from("listing_co_brokers")
      .select("listing_id")
      .eq("broker_id", user.id),
  ]);

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

  const listings: ListingItem[] = (data ?? []).map((l) => {
    const p = (l.profiles as unknown as { first_name: string | null; last_name: string | null; display_email: string | null } | null);
    const brokerName = p?.first_name
      ? `${p.first_name} ${p.last_name ?? ""}`.trim()
      : p?.display_email ?? null;
    return { ...l, broker_name: brokerName };
  });

  // Which of these listings is the current user a co-broker on (vs. owner)?
  const coBrokerIds = new Set((coRows ?? []).map((r) => r.listing_id as string));

  // Rows whose owner's plan has lapsed get sharing/sending locked (downloads
  // stay free). Service client so we can read other brokers' access when an
  // assistant/admin is viewing their listings.
  const service = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const ownerIds = Array.from(new Set(listings.map((l) => l.broker_id).filter(Boolean))) as string[];
  const lockedOwners = new Set<string>();

  // The access checks and the cover-photo lookup are unrelated, so they run
  // side by side rather than the photos waiting on the billing checks.
  const [, heroRowsRes] = await Promise.all([
    Promise.all(ownerIds.map(async (bid) => {
      const { status } = await getEffectiveAccessStatus(service, bid);
      if (!hasAccess(status)) lockedOwners.add(bid);
    })),
    listings.length > 0
      ? supabase.rpc("listing_hero_photos", { p_listing_ids: listings.map((l) => l.id) })
      : Promise.resolve({ data: [] }),
  ]);
  const lockedListingIds = listings.filter((l) => l.broker_id && lockedOwners.has(l.broker_id)).map((l) => l.id);

  // Cover photo per row, resolved server-side. One RPC (DISTINCT ON, honoring
  // the chosen hero_photo_id and falling back to the first visible photo) plus
  // signing — instead of 2-3 client round trips per row.
  //
  // These are signed WITH a resize. A cover thumbnail is a few hundred pixels
  // on screen; serving the full-size original meant a broker with 40 listings
  // downloaded the better part of 80 MB to look at a list. Supabase only
  // accepts a transform when signing one url at a time, so the signing is
  // per-photo — but it all happens in parallel, in one wave.
  const heroes: Record<string, { url: string; fit: "fit" | "fill" }> = {};
  const rows = ((heroRowsRes as { data: unknown }).data ?? []) as { listing_id: string; storage_path: string; hero_fit: string | null }[];
  if (rows.length > 0) {
    const paths = Array.from(new Set(rows.map((r) => r.storage_path)));
    const urlByPath = new Map<string, string>();
    await Promise.all(paths.map(async (path) => {
      const { data: signed } = await supabase.storage
        .from("listing-photos")
        .createSignedUrl(path, 3600, {
          transform: { width: 600, height: 600, resize: "contain", quality: 72 },
        });
      if (signed?.signedUrl) urlByPath.set(path, signed.signedUrl);
    }));
    for (const r of rows) {
      const url = urlByPath.get(r.storage_path);
      if (url) heroes[r.listing_id] = { url, fit: r.hero_fit === "fill" ? "fill" : "fit" };
    }
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 pb-6 border-b border-hairline flex items-center justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">
            {isAssistant ? "Listings" : "My Listings"}
          </h1>
          <p className="text-ink-500 mt-1 text-sm">
            {isAssistant
              ? "Listings across all brokers you assist."
              : "View your photos, toggle visibility, and reorder your gallery."}
          </p>
        </div>
        <Link
          href="/dashboard/listings/new"
          className="shrink-0 bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
        >
          + New Listing
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-16 text-center">
          <p className="text-ink-500 text-sm">No listings yet.</p>
          <p className="text-ink-500 text-sm mt-1">
            {isAssistant
              ? "Listings will appear here once a broker you assist has active listings."
              : "Click '+ New Listing' to upload your own photos, or listings will appear here after a YachtPics shoot."}
          </p>
        </div>
      ) : (
        <>
          {/* Spotlight the newest boat (list is sorted newest-first) so a broker
              lands and can open their latest shoot in one click, without hunting.
              It still appears in the list below — this is just a fast path. */}
          {(() => {
            const top = listings[0];
            const hero = heroes[top.id];
            const specs = [top.year, top.make, top.model, top.length_ft ? `${top.length_ft}′` : null, top.location]
              .filter(Boolean)
              .join(" · ");
            return (
              <Link
                href={`/dashboard/listings/${top.id}`}
                className="group flex items-stretch mb-6 overflow-hidden rounded-card border border-hairline bg-white shadow-elev-1 hover:shadow-elev-2 hover:border-accent-500 transition-all duration-base ease-quiet"
              >
                <div className="relative w-40 sm:w-56 shrink-0 min-h-[8rem] bg-ink-100">
                  {hero?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={hero.url}
                      alt={top.vessel_name ?? "Latest shoot"}
                      className={`absolute inset-0 h-full w-full ${hero.fit === "fill" ? "object-cover" : "object-contain"}`}
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-ink-300 text-xs">No photo yet</div>
                  )}
                </div>
                <div className="flex-1 min-w-0 p-5 sm:p-6 flex flex-col justify-center">
                  <p className="label-caps text-accent-700 mb-1.5">Latest shoot</p>
                  <h2 className="text-h2 text-ink-900 truncate">{top.vessel_name ?? "Untitled vessel"}</h2>
                  {specs && <p className="text-ink-500 text-sm mt-0.5 truncate">{specs}</p>}
                  <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent-700 group-hover:text-accent-600 transition-colors duration-fast">
                    View &amp; download photos <span aria-hidden>&rarr;</span>
                  </span>
                </div>
              </Link>
            );
          })()}
          <ListingsBrowser
            listings={listings}
            currentUserId={user.id}
            coBrokerIds={Array.from(coBrokerIds)}
            lockedListingIds={lockedListingIds}
            heroes={heroes}
          />
        </>
      )}
    </div>
  );
}
