import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function AdminBrokersPage() {
  const supabase = await createClient();

  const { data: brokers } = await supabase
    .from("profiles")
    .select(`
      id, first_name, last_name, display_email, phone, created_at,
      broker_details(brokerage_name),
      subscriptions(plan, status, trial_ends_at)
    `)
    .eq("role", "broker")
    .order("created_at", { ascending: false });

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Brokers</h1>
          <p className="text-gray-500 mt-1 text-sm">{brokers?.length ?? 0} broker accounts.</p>
        </div>
      </div>

      {(!brokers || brokers.length === 0) ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
          <p className="text-gray-400 text-sm">No brokers yet.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Broker</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Brokerage</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Contact</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Plan</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {brokers.map((broker) => {
                const details = broker.broker_details as { brokerage_name: string | null }[] | null;
                const sub = broker.subscriptions as { plan: string; status: string; trial_ends_at: string | null }[] | null;
                const brokerage = details?.[0]?.brokerage_name ?? "—";
                const status = sub?.[0]?.status ?? "—";
                const trialDays = sub?.[0]?.trial_ends_at
                  ? Math.max(0, Math.ceil((new Date(sub[0].trial_ends_at).getTime() - Date.now()) / 86400000))
                  : null;

                return (
                  <tr key={broker.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">
                        {broker.first_name ? `${broker.first_name} ${broker.last_name ?? ""}`.trim() : "—"}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-gray-500 hidden sm:table-cell">{brokerage}</td>
                    <td className="px-6 py-4 text-gray-500 hidden md:table-cell">
                      <p>{broker.display_email ?? "—"}</p>
                      <p className="text-xs text-gray-400">{broker.phone ?? ""}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        status === "active" ? "bg-green-50 text-green-700"
                        : status === "trialing" ? "bg-yellow-50 text-yellow-700"
                        : "bg-gray-100 text-gray-500"
                      }`}>
                        {status === "trialing" && trialDays !== null ? `Trial · ${trialDays}d` : status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/admin/brokers/${broker.id}`}
                        className="text-[#c49a35] hover:text-[#b08c2a] text-xs font-medium transition-colors">
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
