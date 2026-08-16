import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import DeleteAssistantButton from "./[id]/_components/DeleteAssistantButton";
import TableSearch from "@/components/TableSearch";

function loginLabel(iso: string | null | undefined): { text: string; stale: boolean } {
  if (!iso) return { text: "Never", stale: true };
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  const stale = days > 30;
  if (days <= 0) return { text: "Today", stale };
  if (days === 1) return { text: "Yesterday", stale };
  if (days < 14) return { text: `${days} days ago`, stale };
  if (days < 60) return { text: `${Math.floor(days / 7)} weeks ago`, stale };
  return { text: new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), stale };
}

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

  // Per-assistant activity (last login + counts), admin-gated SECURITY DEFINER.
  type Act = { id: string; last_sign_in_at: string | null; brokers_invited: number; client_sends: number; photo_uploads: number };
  const { data: activityRows } = await supabase.rpc("assistant_activity");
  const activity = new Map(((activityRows ?? []) as Act[]).map((r) => [r.id, r]));

  // Show the most recently active first; never-logged-in sink to the bottom.
  const sortedAssistants = [...(assistants ?? [])].sort((a, b) => {
    const la = activity.get(a.id as string)?.last_sign_in_at;
    const lb = activity.get(b.id as string)?.last_sign_in_at;
    if (la && lb) return new Date(lb).getTime() - new Date(la).getTime();
    if (la) return -1;
    if (lb) return 1;
    return 0;
  });

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
        <TableSearch placeholder="Search assistants by name or email…">
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="px-4 sm:px-6 py-3 label-caps">Name</th>
                <th className="px-4 sm:px-6 py-3 label-caps">Last login</th>
                <th className="px-4 sm:px-6 py-3 label-caps hidden lg:table-cell">Activity</th>
                <th className="px-4 sm:px-6 py-3 label-caps hidden md:table-cell">Linked Brokers</th>
                <th className="px-4 sm:px-6 py-3 label-caps hidden lg:table-cell">Added By</th>
                <th className="px-4 sm:px-6 py-3 label-caps sticky right-0 bg-white"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {sortedAssistants.map((assistant) => {
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

                const act = activity.get(assistant.id as string);
                const ll = loginLabel(act?.last_sign_in_at);

                return (
                  <tr key={assistant.id} className="hover:bg-ink-50 transition-colors duration-fast ease-quiet">
                    <td className="px-4 sm:px-6 py-4">
                      <p className="font-medium text-ink-900">
                        {assistant.first_name
                          ? (assistant.first_name + " " + (assistant.last_name ?? "")).trim()
                          : "—"}
                      </p>
                      <p className="text-xs text-ink-500 mt-0.5">{assistant.display_email ?? "—"}</p>
                    </td>
                    <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                      <span className={`text-xs font-medium ${ll.stale ? "text-warn-700" : "text-ink-700"}`}>{ll.text}</span>
                    </td>
                    <td className="px-4 sm:px-6 py-4 hidden lg:table-cell text-xs text-ink-500 tabular-nums whitespace-nowrap">
                      {act ? `${act.brokers_invited} invited · ${act.client_sends} sent · ${act.photo_uploads} uploads` : "—"}
                    </td>
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
        </TableSearch>
      )}
    </div>
  );
}
