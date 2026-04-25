import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function AdminPage() {
  const supabase = await createClient();

  const [{ count: brokerCount }, { count: listingCount }, { count: shootCount }, { data: recentShoots }] =
    await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "broker"),
      supabase.from("listings").select("*", { count: "exact", head: true }),
      supabase.from("shoots").select("*", { count: "exact", head: true }).eq("payment_status", "pending"),
      supabase.from("shoots")
        .select("id, shoot_date, amount_cents, payment_status, invoice_number, profiles:broker_id(first_name, last_name), listings:listing_id(vessel_name)")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Admin Overview</h1>
        <p className="text-gray-500 mt-1 text-sm">YachtPics Portal — internal management.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Link href="/admin/brokers" className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] transition-colors">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Brokers</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{brokerCount ?? 0}</p>
        </Link>
        <Link href="/admin/listings" className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] transition-colors">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Listings</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{listingCount ?? 0}</p>
        </Link>
        <Link href="/admin/shoots" className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] transition-colors">
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Pending Invoices</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{shootCount ?? 0}</p>
        </Link>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <Link href="/admin/listings/new"
          className="bg-[#050b14] hover:bg-[#0a1628] text-white rounded-xl p-5 transition-colors">
          <div className="text-2xl mb-2">➕</div>
          <h3 className="font-semibold mb-1">New Listing</h3>
          <p className="text-gray-400 text-sm">Create a listing and upload photos for a broker.</p>
        </Link>
        <Link href="/admin/shoots/new"
          className="bg-[#050b14] hover:bg-[#0a1628] text-white rounded-xl p-5 transition-colors">
          <div className="text-2xl mb-2">📄</div>
          <h3 className="font-semibold mb-1">New Invoice</h3>
          <p className="text-gray-400 text-sm">Log a shoot and create an invoice for a broker.</p>
        </Link>
      </div>

      {/* Recent shoots */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Shoots</h2>
          <Link href="/admin/shoots" className="text-[#c49a35] hover:text-[#b08c2a] text-sm font-medium">View all →</Link>
        </div>
        {recentShoots && recentShoots.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {recentShoots.map((shoot) => {
              const broker = shoot.profiles as { first_name: string | null; last_name: string | null } | null;
              const listing = shoot.listings as { vessel_name: string | null } | null;
              const amount = shoot.amount_cents
                ? `$${(shoot.amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                : "—";
              return (
                <li key={shoot.id} className="px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {broker ? `${broker.first_name ?? ""} ${broker.last_name ?? ""}`.trim() : "Unknown broker"}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{listing?.vessel_name ?? "No vessel"}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-sm font-medium text-gray-900">{amount}</p>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      shoot.payment_status === "paid" ? "bg-green-50 text-green-700"
                      : shoot.payment_status === "cancelled" ? "bg-gray-100 text-gray-500"
                      : "bg-yellow-50 text-yellow-700"
                    }`}>
                      {shoot.payment_status}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-center py-10 text-gray-400 text-sm">No shoots yet.</div>
        )}
      </div>
    </div>
  );
}
