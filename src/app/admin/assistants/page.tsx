import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import DeleteAssistantButton from "./[id]/_components/DeleteAssistantButton";

export default async function AdminAssistantsPage() {
  const supabase = await createClient();

  const { data: assistants } = await supabase
    .from("profiles")
    .select(`
      id, first_name, last_name, display_email, created_at,
      broker_assistants!assistant_id(broker_id, profiles:broker_id(first_name, last_name, display_email))
    `)
    .eq("role", "assistant")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Assistants</h1>
          <p className="text-gray-500 mt-1 text-sm">{assistants?.length ?? 0} assistant accounts.</p>
        </div>
        <Link
          href="/admin/assistants/new"
          className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
        >
          + Invite Assistant
        </Link>
      </div>

      {(!assistants || assistants.length === 0) ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
          <p className="text-gray-400 text-sm">No assistants yet.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Email</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Linked Brokers</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {assistants.map((assistant) => {
                type LinkRow = { broker_id: string; profiles: { first_name: string | null; last_name: string | null; display_email: string | null } | null };
                const links = (assistant.broker_assistants as unknown) as LinkRow[] | null;
                const brokerNames = (links ?? []).map((l) => {
                  const p = l.profiles;
                  return p?.first_name ? (p.first_name + " " + (p.last_name ?? "")).trim() : p?.display_email ?? "Unknown";
                });

                return (
                  <tr key={assistant.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {assistant.first_name
                        ? (assistant.first_name + " " + (assistant.last_name ?? "")).trim()
                        : "—"}
                    </td>
                    <td className="px-6 py-4 text-gray-500 hidden sm:table-cell">{assistant.display_email ?? "—"}</td>
                    <td className="px-6 py-4 hidden md:table-cell">
                      {brokerNames.length === 0 ? (
                        <span className="text-gray-300 text-xs">None yet</span>
                      ) : (
                        <span className="text-gray-600 text-xs">{brokerNames.join(", ")}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-4">
                        <DeleteAssistantButton
                          assistantId={assistant.id}
                          displayName={assistant.first_name
                            ? (assistant.first_name + " " + (assistant.last_name ?? "")).trim()
                            : assistant.display_email ?? "this assistant"}
                        />
                        <Link href={"/admin/assistants/" + assistant.id}
                          className="text-[#c49a35] hover:text-[#b08c2a] text-xs font-medium transition-colors">
                          Manage &rarr;
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
