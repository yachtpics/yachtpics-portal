import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import TableSearch from "@/components/TableSearch";

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
          <h1 className="text-display text-ink-900">Shoots & Invoices</h1>
          <p className="text-ink-500 mt-1 text-sm tabular-nums">
            {total} total · {pending} pending · {paid} paid
          </p>
        </div>
        <Link
          href="/admin/shoots/new"
          className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          + New Invoice
        </Link>
      </div>

      {total === 0 ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-16 text-center">
          <p className="text-ink-400 text-sm">No shoots on record yet.</p>
          <Link href="/admin/shoots/new" className="inline-block mt-4 text-accent-700 text-sm font-medium">
            Log the first one →
          </Link>
        </div>
      ) : (
        <TableSearch placeholder="Search shoots by broker, vessel, invoice…">
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="px-6 py-3 label-caps">Date</th>
                <th className="px-6 py-3 label-caps">Broker</th>
                <th className="px-6 py-3 label-caps hidden sm:table-cell">Vessel</th>
                <th className="px-6 py-3 label-caps hidden md:table-cell">Invoice #</th>
                <th className="px-6 py-3 label-caps hidden md:table-cell">Method</th>
                <th className="px-6 py-3 label-caps text-right">Amount</th>
                <th className="px-6 py-3 label-caps">Status</th>
                <th className="px-6 py-3 label-caps"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
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
                  <tr key={shoot.id} className="hover:bg-ink-50 transition-colors duration-fast ease-quiet">
                    <td className="px-6 py-4 text-ink-700 whitespace-nowrap tabular-nums">{date}</td>
                    <td className="px-6 py-4 text-ink-900 font-medium">{brokerName}</td>
                    <td className="px-6 py-4 text-ink-500 hidden sm:table-cell">{vessel}</td>
                    <td className="px-6 py-4 text-ink-500 hidden md:table-cell tabular-nums">{shoot.invoice_number ?? "—"}</td>
                    <td className="px-6 py-4 text-ink-500 hidden md:table-cell capitalize">{shoot.payment_method ?? "—"}</td>
                    <td className="px-6 py-4 text-ink-900 font-medium text-right tabular-nums">{amount}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                        shoot.payment_status === "paid" ? "bg-success-50 text-success-700 border-success-200"
                        : shoot.payment_status === "cancelled" ? "bg-ink-100 text-ink-600 border-hairline"
                        : "bg-warn-50 text-warn-700 border-warn-200"
                      }`}>
                        {shoot.payment_status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/admin/shoots/${shoot.id}`} className="text-accent-700 hover:text-accent-800 text-xs font-medium transition-colors duration-fast ease-quiet">
                        Edit →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </TableSearch>
      )}
    </div>
  );
}
