import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import DeleteAssistantButton from "./[id]/_components/DeleteAssistantButton";

export default async function AdminAssistantsPage() {
  const supabase = await createClient();

  const { data: assistants } = await supabase
    .from("profiles")
    .select(`
      id, first_name, last_name, display_email, created_at,
      broker_assistants!assistant_id(broker_id, profiles:broker_id(first_name, last_name, display_email, invited_by))
    `)
    .eq("role", "assistant")
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
          <h1 className="text-display text-ink-900">Assistants</h1>
          <p className="text-ink-500 mt-1 text-sm">{assistants?.length ?? 0} assistant accounts.</p>
        </div>
        <Link
          href="/admin/assistants/new"
          className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          + Invite Assistant
        </Link>
      </div>

      {(!assistants || assistants.length === 0) ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-16 text-center">
          <p className="text-ink-400 text-sm">No assistants yet.</p>
        </div>
      ) : (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="px-4 sm:px-6 py-3 label-caps">Name</th>
                <th className="px-4 sm:px-6 py-3 label-caps hidden sm:table-cell">Email</th>
                <th className="px-4 sm:px-6 py-3 label-caps hidden md:table-cell">Linked Brokers</th>
                <th className="px-4 sm:px-6 py-3 label-caps hidden lg:table-cell">Added By</th>
                <th className="px-4 sm:px-6 py-3 label-caps sticky right-0 bg-white"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {assistants.map((assistant) => {
                type LinkRow = { broker_id: string; profiles: { first_name: string | null; last_name: string | null; display_email: string | null; invited_by: string | null } | null };
                const links = (assistant.broker_assistants as unknown) as LinkRow[] | null;
                const brokerNames = (links ?? []).map((l) => {
                  const p = l.profiles;
                  return p?.first_name ? (p.first_name + " " + (p.last_name ?? "")).trim() : p?.display_email ?? "Unknown";
                });
                // Derive the owning admin(s) from the assistant's linked brokers.
                const ownerIds = Array.from(
                  new Set((links ?? []).map((l) => l.profiles?.invited_by).filter(Boolean) as string[])
                );
                const ownerLabel = ownerIds.length === 0
                  ? "—"
                  : ownerIds.length === 1
                  ? (adminNameById.get(ownerIds[0]) ?? "—")
                  : "Multiple";

                return (
                  <tr key={assistant.id} className="hover:bg-ink-50 transition-colors duration-fast ease-quiet">
                    <td className="px-4 sm:px-6 py-4 font-medium text-ink-900">
                      {assistant.first_name
                        ? (assistant.first_name + " " + (assistant.last_name ?? "")).trim()
                        : "—"}
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-ink-500 hidden sm:table-cell">{assistant.display_email ?? "—"}</td>
                    <td className="px-4 sm:px-6 py-4 hidden md:table-cell">
                      {brokerNames.length === 0 ? (
                        <span className="text-ink-400 text-xs">None yet</span>
                      ) : (
                        <span className="text-ink-600 text-xs">{brokerNames.join(", ")}</span>
                      )}
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-ink-500 text-xs hidden lg:table-cell">{ownerLabel}</td>
                    <td className="px-4 sm:px-6 py-4 text-right sticky right-0 bg-white whitespace-nowrap shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.08)]">
                      <div className="flex items-center justify-end gap-4">
                        <DeleteAssistantButton
                          assistantId={assistant.id}
                          displayName={assistant.first_name
                            ? (assistant.first_name + " " + (assistant.last_name ?? "")).trim()
                            : assistant.display_email ?? "this assistant"}
                        />
                        <Link href={"/admin/assistants/" + assistant.id}
                          className="text-accent-700 hover:text-accent-800 text-xs font-medium transition-colors duration-fast ease-quiet">
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
