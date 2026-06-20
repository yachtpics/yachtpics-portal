import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import DeleteBrokerButton from "./[id]/DeleteBrokerButton";

export default async function AdminBrokersPage() {
  const supabase = await createClient();

  const { data: brokers } = await supabase
    .from("profiles")
    .select(`
      id, first_name, last_name, display_email, phone, created_at, welcomed_at, invited_by,
      broker_details(brokerage_name),
      subscriptions(plan, status, trial_ends_at)
    `)
    .eq("role", "broker")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  const { data: adminProfiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .eq("role", "admin");
  const adminNameById = new Map(
    (adminProfiles ?? []).map((a) => [
      a.id as string,
      a.first_name ? `${a.first_name} ${a.last_name ?? ""}`.trim() : "Admin",
    ])
  );

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Brokers</h1>
          <p className="text-gray-500 mt-1 text-sm">{brokers?.length ?? 0} broker accounts.</p>
        </div>
        <Link
          href="/admin/brokers/new"
          className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
        >
          + Invite Broker
        </Link>
      </div>

      {(!brokers || brokers.length === 0) ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
          <p className="text-gray-400 text-sm">No brokers yet.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Broker</th>
                <th className="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Brokerage</th>
                <th className="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Contact</th>
                <th className="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Added By</th>
                <th className="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Plan</th>
                <th className="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky right-0 bg-white"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {brokers.map((broker) => {
                const details = broker.broker_details as { brokerage_name: string | null } | { brokerage_name: string | null }[] | null;
                const sub = broker.subscriptions as { plan: string; status: string; trial_ends_at: string | null }[] | null;
                const brokerage = (Array.isArray(details) ? details[0]?.brokerage_name : details?.brokerage_name) ?? "—";
                const status = sub?.[0]?.status ?? "—";
                const trialDays = sub?.[0]?.trial_ends_at
                  ? Math.max(0, Math.ceil((new Date(sub[0].trial_ends_at).getTime() - Date.now()) / 86400000))
                  : null;

                const invited = !broker.welcomed_at;

                return (
                  <tr key={broker.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 sm:px-6 py-4">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">
                          {broker.first_name ? `${broker.first_name} ${broker.last_name ?? ""}`.trim() : "—"}
                        </p>
                        {invited && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                            Invited
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-gray-500 hidden sm:table-cell">{brokerage}</td>
                    <td className="px-4 sm:px-6 py-4 text-gray-500 hidden md:table-cell">
                      <p>{broker.display_email ?? "—"}</p>
                      <p className="text-xs text-gray-400">{broker.phone ?? ""}</p>
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-gray-500 hidden lg:table-cell">
                      {broker.invited_by ? (adminNameById.get(broker.invited_by as string) ?? "—") : "—"}
                    </td>
                    <td className="px-4 sm:px-6 py-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        status === "active" ? "bg-green-50 text-green-700"
                        : status === "trialing" ? "bg-yellow-50 text-yellow-700"
                        : "bg-gray-100 text-gray-500"
                      }`}>
                        {status === "trialing" && trialDays !== null ? `Trial · ${trialDays}d` : status}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-right sticky right-0 bg-white whitespace-nowrap shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.08)]">
                      <div className="flex items-center justify-end gap-4">
                        <DeleteBrokerButton
                          brokerId={broker.id}
                          brokerName={broker.first_name ? `${broker.first_name} ${broker.last_name ?? ""}`.trim() : broker.display_email ?? "this broker"}
                        />
                        <Link href={`/admin/brokers/${broker.id}`}
                          className="text-[#c49a35] hover:text-[#b08c2a] text-xs font-medium transition-colors">
                          Manage →
                        </Link>
                      </div>
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
