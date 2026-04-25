import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function AdminBrokerDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();

  const [{ data: profile }, { data: details }, { data: subscription }, { data: listings }, { data: shoots }] =
    await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name, display_email, phone, created_at").eq("id", params.id).single(),
      supabase.from("broker_details").select("*").eq("id", params.id).single(),
      supabase.from("subscriptions").select("plan, status, trial_ends_at, current_period_end").eq("broker_id", params.id).single(),
      supabase.from("listings").select("id, vessel_name, vessel_type, year, length_ft, location, status, updated_at").eq("broker_id", params.id).order("updated_at", { ascending: false }),
      supabase.from("shoots").select("id, shoot_date, amount_cents, payment_status, invoice_number, listings:listing_id(vessel_name)").eq("broker_id", params.id).order("shoot_date", { ascending: false }).limit(10),
    ]);

  if (!profile) notFound();

  const name = profile.first_name ? `${profile.first_name} ${profile.last_name ?? ""}`.trim() : profile.display_email ?? "Broker";
  const trialDays = subscription?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/admin/brokers" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">
          ← All brokers
        </Link>
        <div className="flex items-start justify-between mt-1">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{name}</h1>
            <p className="text-gray-500 text-sm mt-0.5">{details?.brokerage_name ?? "No brokerage"}</p>
          </div>
          <Link
            href={`/admin/shoots/new?broker=${params.id}`}
            className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
          >
            + New Invoice
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {/* Contact */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Contact</p>
          <p className="text-sm text-gray-900">{profile.display_email ?? "—"}</p>
          <p className="text-sm text-gray-500 mt-1">{profile.phone ?? "—"}</p>
          {details?.brokerage_address && (
            <p className="text-sm text-gray-500 mt-1">
              {details.brokerage_address}, {details.brokerage_city ?? ""} {details.brokerage_state ?? ""}
            </p>
          )}
          {details?.license_number && (
            <p className="text-xs text-gray-400 mt-2">License: {details.license_number}</p>
          )}
        </div>

        {/* Subscription */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Subscription</p>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
            subscription?.status === "active" ? "bg-green-50 text-green-700"
            : subscription?.status === "trialing" ? "bg-yellow-50 text-yellow-700"
            : "bg-gray-100 text-gray-500"
          }`}>
            {subscription?.status === "trialing" && trialDays !== null
              ? `Trial · ${trialDays} day${trialDays !== 1 ? "s" : ""} left`
              : subscription?.status ?? "—"}
          </span>
          <p className="text-sm text-gray-500 mt-2 capitalize">Plan: {subscription?.plan ?? "free"}</p>
          {subscription?.current_period_end && (
            <p className="text-xs text-gray-400 mt-1">
              Renews {new Date(subscription.current_period_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Activity</p>
          <p className="text-sm text-gray-900"><span className="text-2xl font-bold">{listings?.length ?? 0}</span> listings</p>
          <p className="text-sm text-gray-500 mt-1"><span className="font-semibold text-gray-900">{shoots?.length ?? 0}</span> shoots on record</p>
          <p className="text-xs text-gray-400 mt-2">
            Member since {new Date(profile.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
          </p>
        </div>
      </div>

      {/* Listings */}
      <div className="bg-white border border-gray-200 rounded-xl mb-6">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Listings ({listings?.length ?? 0})</h2>
          <Link href={`/admin/listings/new?broker=${params.id}`} className="text-[#c49a35] hover:text-[#b08c2a] text-sm font-medium transition-colors">
            + New listing
          </Link>
        </div>
        {!listings || listings.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No listings yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {listings.map((listing) => (
              <li key={listing.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div>
                  <p className="text-sm font-medium text-gray-900">{listing.vessel_name ?? "Untitled"}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[listing.year, listing.vessel_type, listing.length_ft ? `${listing.length_ft}′` : null, listing.location].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    listing.status === "active" ? "bg-green-50 text-green-700"
                    : listing.status === "sold" ? "bg-blue-50 text-blue-700"
                    : "bg-gray-100 text-gray-500"
                  }`}>{listing.status}</span>
                  <Link href={`/admin/listings/${listing.id}`} className="text-[#c49a35] hover:text-[#b08c2a] text-xs font-medium transition-colors">
                    Manage →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Shoot history */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Shoot History</h2>
          <Link href={`/admin/shoots/new?broker=${params.id}`} className="text-[#c49a35] hover:text-[#b08c2a] text-sm font-medium transition-colors">
            + New invoice
          </Link>
        </div>
        {!shoots || shoots.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No shoots on record.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {shoots.map((shoot) => {
              const vessel = (shoot.listings as { vessel_name: string | null }[] | null)?.[0]?.vessel_name ?? "—";
              const amount = shoot.amount_cents
                ? `$${(shoot.amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                : "—";
              const date = shoot.shoot_date
                ? new Date(shoot.shoot_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : "—";
              return (
                <li key={shoot.id} className="px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{vessel}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{date} · {shoot.invoice_number ?? "No invoice #"}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-sm font-medium text-gray-900">{amount}</p>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      shoot.payment_status === "paid" ? "bg-green-50 text-green-700"
                      : shoot.payment_status === "cancelled" ? "bg-gray-100 text-gray-500"
                      : "bg-yellow-50 text-yellow-700"
                    }`}>{shoot.payment_status}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
