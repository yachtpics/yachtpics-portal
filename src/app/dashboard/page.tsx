import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import Link from "next/link";
import HelpTip from "@/components/HelpTip";
import EnableNotifications from "@/components/EnableNotifications";
import FeaturedStrip, { type FeaturedBoat } from "@/components/FeaturedStrip";
import { Badge, Card } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";

function statusTone(status: string): BadgeTone {
  if (status === "active") return "success";
  if (status === "sold") return "info";
  return "neutral";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, role")
    .eq("id", user.id)
    .single();

  const isAssistant = profile?.role === "assistant";
  const firstName = profile?.first_name ?? "there";

  // Recently Photographed rotating strip (shared by broker + assistant views).
  const { data: scData } = await supabase.rpc("showcase_listings");
  type ScRow = { listing_id: string; vessel_name: string | null; year: number | null; make: string | null; model: string | null; location: string | null; broker_name: string | null; hero_storage_path: string | null };
  const scRows = ((scData ?? []) as ScRow[]).slice(0, 12);
  let featured: FeaturedBoat[] = [];
  if (scRows.length > 0) {
    const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const paths = Array.from(new Set(scRows.map((r) => r.hero_storage_path).filter(Boolean))) as string[];
    const urls = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await svc.storage.from("listing-photos").createSignedUrls(paths, 3600);
      for (const s of signed ?? []) if (s.signedUrl && s.path) urls.set(s.path, s.signedUrl);
    }
    featured = scRows.map((r) => ({
      id: r.listing_id,
      vesselName: r.vessel_name ?? "Untitled Vessel",
      subtitle: [r.year, r.make, r.model].filter(Boolean).join(" "),
      location: r.location ?? "",
      heroUrl: r.hero_storage_path ? (urls.get(r.hero_storage_path) ?? null) : null,
      brokerName: r.broker_name,
    }));
  }

  // ── Assistant dashboard ──────────────────────────────────────────────────
  if (isAssistant) {
    const { data: links } = await supabase
      .from("broker_assistants")
      .select("broker_id, profiles:broker_id(first_name, last_name, display_email)")
      .eq("assistant_id", user.id);

    const brokers = (links ?? []).map((l) => {
      const p = (l.profiles as unknown as { first_name: string | null; last_name: string | null; display_email: string | null } | null);
      return {
        id: l.broker_id as string,
        name: p?.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : p?.display_email ?? "Broker",
      };
    });

    // Fetch recent listings across all linked brokers
    const brokerIds = brokers.map((b) => b.id);
    const { data: recentListings } = brokerIds.length > 0
      ? await supabase
          .from("listings")
          .select("id, vessel_name, location, status, broker_id")
          .in("broker_id", brokerIds)
          .order("updated_at", { ascending: false })
          .limit(5)
      : { data: [] };

    const brokerMap = Object.fromEntries(brokers.map((b) => [b.id, b.name]));

    return (
      <div className="px-4 sm:px-6 py-8 max-w-5xl mx-auto">
        <div className="mb-8 pb-6 border-b border-hairline">
          <h1 className="text-display text-ink-900">Welcome back, {firstName}</h1>
          <p className="text-ink-500 mt-1.5 text-sm">
            You&apos;re assisting {brokers.length} broker{brokers.length !== 1 ? "s" : ""}.
          </p>
        </div>

        <FeaturedStrip boats={featured} />

        <Card className="mb-8 grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-hairline">
          <div className="px-6 py-5">
            <p className="label-caps mb-2">Brokers</p>
            <p className="text-3xl font-light tabular-nums text-ink-900">{brokers.length}</p>
          </div>
          <div className="px-6 py-5">
            <p className="label-caps mb-2">Active Listings</p>
            <p className="text-3xl font-light tabular-nums text-ink-900">
              {recentListings?.filter((l) => l.status === "active").length ?? 0}
            </p>
          </div>
        </Card>

        <Link
          href="/dashboard/listings"
          className="group block bg-white border border-hairline rounded-card shadow-elev-1 p-6 mb-8 transition-all duration-base ease-quiet hover:shadow-elev-2 hover:border-hairline-strong"
        >
          <h3 className="text-h2 text-ink-900 mb-1">Listings</h3>
          <p className="text-ink-500 text-sm">View and manage listings across all your brokers.</p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent-700 transition-colors duration-fast group-hover:text-accent-600">
            View listings <span aria-hidden>&rarr;</span>
          </span>
        </Link>

        <Card>
          <div className="px-6 py-4 border-b border-hairline">
            <p className="label-caps">Recent Listings</p>
          </div>
          {recentListings && recentListings.length > 0 ? (
            <ul className="divide-y divide-hairline">
              {recentListings.map((listing) => (
                <li key={listing.id}>
                  <Link href={`/dashboard/listings/${listing.id}`} className="px-6 py-4 flex items-center justify-between gap-3 hover:bg-ink-50 transition-colors duration-fast block">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-900 truncate">{listing.vessel_name ?? "Untitled vessel"}</p>
                      <p className="text-xs text-accent-700 mt-0.5">{brokerMap[listing.broker_id] ?? "—"}</p>
                      <p className="text-xs text-ink-400 mt-0.5">{listing.location ?? ""}</p>
                    </div>
                    <Badge tone={statusTone(listing.status)}>{listing.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-center py-12 text-ink-400 text-sm">
              No listings yet across your brokers.
            </div>
          )}
        </Card>
      </div>
    );
  }

  // ── Broker dashboard ─────────────────────────────────────────────────────
  const { data: listings } = await supabase
    .from("listings")
    .select("id, vessel_name, location, status, updated_at")
    .eq("broker_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(5);

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan, status, trial_ends_at")
    .eq("broker_id", user.id)
    .single();

  const { data: brokerDetails } = await supabase
    .from("broker_details")
    .select("brokerage_name, logo_url")
    .eq("id", user.id)
    .single();

  const activeListings = listings?.filter((l) => l.status === "active").length ?? 0;

  const trialDaysLeft = subscription?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null;

  const isNewAccount = (!listings || listings.length === 0) && !brokerDetails?.logo_url;

  return (
    <div className="px-4 sm:px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 pb-6 border-b border-hairline">
        <h1 className="text-display text-ink-900">Welcome back, {firstName}</h1>
        <p className="text-ink-500 mt-1.5 text-sm">Manage your listings and create buyer presentations.</p>
      </div>

      <FeaturedStrip boats={featured} />

      {isNewAccount && (
        <div className="bg-ink-950 rounded-card px-6 py-6 mb-6 shadow-elev-2">
          <p className="text-white font-semibold text-sm">Get set up in 3 steps</p>
          <p className="text-ink-400 text-xs mt-1">Complete these before your first shoot delivery.</p>
          <div className="rule-inverse my-4" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link href="/dashboard/profile" className="bg-white/[0.03] hover:bg-white/[0.07] border border-hairline-inverse-soft rounded-ctl px-4 py-3 transition-colors duration-base ease-quiet block">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold text-accent-300 border border-accent-300/40 w-5 h-5 rounded-full flex items-center justify-center shrink-0">1</span>
                <p className="text-white text-xs font-semibold">Complete your profile</p>
              </div>
              <p className="text-ink-400 text-xs leading-relaxed mb-2">Add your contact info and brokerage details.</p>
              <span className="text-accent-300 text-xs font-medium">Go to Profile</span>
            </Link>
            <Link href="/dashboard/profile" className="bg-white/[0.03] hover:bg-white/[0.07] border border-hairline-inverse-soft rounded-ctl px-4 py-3 transition-colors duration-base ease-quiet block">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold text-accent-300 border border-accent-300/40 w-5 h-5 rounded-full flex items-center justify-center shrink-0">2</span>
                <p className="text-white text-xs font-semibold">Upload your logo</p>
              </div>
              <p className="text-ink-400 text-xs leading-relaxed mb-2">It appears in every client slideshow footer.</p>
              <span className="text-accent-300 text-xs font-medium">Upload Logo</span>
            </Link>
            <Link href="/dashboard/billing" className="bg-white/[0.03] hover:bg-white/[0.07] border border-hairline-inverse-soft rounded-ctl px-4 py-3 transition-colors duration-base ease-quiet block">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold text-accent-300 border border-accent-300/40 w-5 h-5 rounded-full flex items-center justify-center shrink-0">3</span>
                <p className="text-white text-xs font-semibold">Choose a plan</p>
              </div>
              <p className="text-ink-400 text-xs leading-relaxed mb-2">Unlock the slideshow builder. Free 30-day trial.</p>
              <span className="text-accent-300 text-xs font-medium">View Plans</span>
            </Link>
          </div>
        </div>
      )}

      {/* Only during an active trial (6+ days). The expiring/ended states are
          owned by the top TrialBanner, so this no longer duplicates it. */}
      {subscription?.status === "trialing" && trialDaysLeft !== null && trialDaysLeft > 5 && (
        <div className="bg-accent-50 border border-accent-200 rounded-card px-5 py-4 mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-accent-800 font-medium text-sm">
              Your free trial ends in {trialDaysLeft} days.
            </p>
            <p className="text-ink-500 text-xs mt-0.5">Upgrade to keep building slideshows and sharing listings.</p>
          </div>
          <Link href="/dashboard/billing" className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2">
            Upgrade
          </Link>
        </div>
      )}

      {/* Nudge brokers to enable buyer-view + photo-ready push alerts (hides once on) */}
      <div className="mb-6">
        <EnableNotifications onlyWhenOff />
      </div>

      <Card className="mb-8 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-hairline">
        <div className="px-6 py-5">
          <div className="flex items-center gap-1.5 mb-2">
            <p className="label-caps">Active Listings</p>
            <HelpTip text="Listings marked Active are live and shareable with clients." position="below" />
          </div>
          <p className="text-3xl font-light tabular-nums text-ink-900">{activeListings}</p>
        </div>
        <div className="px-6 py-5">
          <div className="flex items-center gap-1.5 mb-2">
            <p className="label-caps">Total Shoots</p>
            <HelpTip text="Your cumulative YachtPics shoot count. New shoots appear in Shoots and Invoices after delivery." position="below" />
          </div>
          <p className="text-3xl font-light tabular-nums text-ink-900">&mdash;</p>
        </div>
        <div className="px-6 py-5">
          <div className="flex items-center gap-1.5 mb-2">
            <p className="label-caps">Plan</p>
            <HelpTip text="Your current subscription tier. Photo downloads are always free. A paid plan unlocks the slideshow builder." detail="Go to Billing to upgrade or manage your plan." position="below" />
          </div>
          <p className="text-3xl font-light text-ink-900 capitalize">
            {subscription?.status === "trialing" ? "Trial" : (subscription?.plan ?? "Free")}
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <Link
          href="/dashboard/listings"
          className="group bg-white border border-hairline rounded-card shadow-elev-1 p-6 transition-all duration-base ease-quiet hover:shadow-elev-2 hover:border-hairline-strong"
        >
          <h3 className="text-h2 text-ink-900 mb-1">My Listings</h3>
          <p className="text-ink-500 text-sm">View photos, toggle visibility, and reorder your listing gallery.</p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent-700 transition-colors duration-fast group-hover:text-accent-600">
            View listings <span aria-hidden>&rarr;</span>
          </span>
        </Link>
        <Link
          href="/dashboard/shoots"
          className="group bg-white border border-hairline rounded-card shadow-elev-1 p-6 transition-all duration-base ease-quiet hover:shadow-elev-2 hover:border-hairline-strong"
        >
          <h3 className="text-h2 text-ink-900 mb-1">Shoots &amp; Invoices</h3>
          <p className="text-ink-500 text-sm">Track your shoot history and view payment status.</p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent-700 transition-colors duration-fast group-hover:text-accent-600">
            View shoots <span aria-hidden>&rarr;</span>
          </span>
        </Link>
      </div>

      <Card>
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <p className="label-caps">Recent Listings</p>
          <Link href="/dashboard/listings" className="text-accent-700 hover:text-accent-600 text-sm font-medium transition-colors duration-fast">
            View all &rarr;
          </Link>
        </div>
        {listings && listings.length > 0 ? (
          <ul className="divide-y divide-hairline">
            {listings.map((listing) => (
              <li key={listing.id} className="px-6 py-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900 truncate">{listing.vessel_name ?? "Untitled vessel"}</p>
                  <p className="text-xs text-ink-400 mt-0.5">{listing.location ?? "Location TBD"}</p>
                </div>
                <Badge tone={statusTone(listing.status)}>{listing.status}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-12 text-ink-400">
            <p className="text-sm">No listings yet.</p>
            <p className="text-sm mt-1">Upload your own photos or they&apos;ll appear here after a YachtPics shoot.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
