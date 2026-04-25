import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function AdminShootsPage() {
  const supabase = await createClient();

  const { data: shoots } = await supabase
    .from("shoots")
    .select(`
      id, shoot_date, location, amount_cents, payment_method,
      payment_status, invoice_number, notes,
      profiles:broker_id(first_name, last_name, display_email),
      listings:listing_id(vessel_name)
    `)
    .order("shoot_date", { ascending: false });

  const total = shoots?.length ?? 0;
  const pending = shoots?.filter((s) => s.payment_status === "pending").length ?? 0;
  const paid = shoots?.filter((s) => s.payment_status === "paid").length ?? 0;

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shoots & Invoices</h1>
          <p className="text-gray-500 mt-1 text-sm">
            {total} total · {pending} pending · {paid} paid
          </p>
        </div>
        <Link
          href="/admin/shoots/new"
          className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
        >
          + New Invoice
        </Link>
      </div>

      {total === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
          <p className="text-gray-400 text-sm">No shoots on record yet.</p>
          <Link href="/admin/shoots/new" className="inline-block mt-4 text-[#c49a35] text-sm font-medium">
            Log the first one →
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Broker</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Vessel</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Invoice #</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Method</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Amount</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shoots!.map((shoot) => {
                const brokerArr = shoot.profiles as { first_name: string | null; last_name: string | null; display_email: string | null }[] | null;
                const broker = Array.isArray(brokerArr) ? brokerArr[0] : brokerArr;
                const listingArr = shoot.listings as { vessel_name: string | null }[] | null;
                const vessel = (Array.isArray(listingArr) ? listingArr[0] : listingArr)?.vessel_name ?? "—";
                const brokerName = broker?.first_name
                  ? `${broker.first_name} ${broker.last_name ?? ""}`.trim()
                  : broker?.display_email ?? "—";
                const amount = shoot.amount_cents
                  ? `$${(shoot.amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                  : "—";
                const date = shoot.shoot_date
                  ? new Date(shoot.shoot_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "—";

                return (
                  <tr key={shoot.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-gray-700 whitespace-nowrap">{date}</td>
                    <td className="px-6 py-4 text-gray-900 font-medium">{brokerName}</td>
                    <td className="px-6 py-4 text-gray-500 hidden sm:table-cell">{vessel}</td>
                    <td className="px-6 py-4 text-gray-500 hidden md:table-cell">{shoot.invoice_number ?? "—"}</td>
                    <td className="px-6 py-4 text-gray-500 hidden md:table-cell capitalize">{shoot.payment_method ?? "—"}</td>
                    <td className="px-6 py-4 text-gray-900 font-medium text-right">{amount}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        shoot.payment_status === "paid" ? "bg-green-50 text-green-700"
                        : shoot.payment_status === "cancelled" ? "bg-gray-100 text-gray-500"
                        : "bg-yellow-50 text-yellow-700"
                      }`}>
                        {shoot.payment_status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/admin/shoots/${shoot.id}`} className="text-[#c49a35] hover:text-[#b08c2a] text-xs font-medium transition-colors">
                        Edit →
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
