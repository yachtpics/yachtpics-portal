import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function ShootsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: shoots } = await supabase
    .from("shoots")
    .select("id, shoot_date, location, amount_cents, payment_method, payment_status, invoice_number, listings(vessel_name)")
    .eq("broker_id", user.id)
    .order("shoot_date", { ascending: false });

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Shoots & Invoices</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Your shoot history and payment status.
        </p>
      </div>

      {(!shoots || shoots.length === 0) ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
          <p className="text-gray-400 text-sm">No shoots on record yet.</p>
          <p className="text-gray-400 text-sm mt-1">
            Invoices will appear here after your first YachtPics session.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Vessel</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Invoice</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Method</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Amount</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shoots.map((shoot) => {
                const amount = shoot.amount_cents
                  ? `$${(shoot.amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                  : "—";
                const date = shoot.shoot_date
                  ? new Date(shoot.shoot_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "—";
                const listingArr = shoot.listings as { vessel_name: string | null }[] | null;
                const vessel = (Array.isArray(listingArr) ? listingArr[0] : listingArr)?.vessel_name ?? "—";

                return (
                  <tr key={shoot.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-gray-700 whitespace-nowrap">{date}</td>
                    <td className="px-6 py-4 text-gray-900 font-medium">{vessel}</td>
                    <td className="px-6 py-4 text-gray-500 hidden sm:table-cell">{shoot.invoice_number ?? "—"}</td>
                    <td className="px-6 py-4 text-gray-500 hidden md:table-cell capitalize">{shoot.payment_method ?? "—"}</td>
                    <td className="px-6 py-4 text-gray-900 font-medium text-right">{amount}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        shoot.payment_status === "paid"
                          ? "bg-green-50 text-green-700"
                          : shoot.payment_status === "cancelled"
                          ? "bg-gray-100 text-gray-500"
                          : "bg-yellow-50 text-yellow-700"
                      }`}>
                        {shoot.payment_status}
                      </span>
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
