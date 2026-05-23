import { createClient } from "@/lib/supabase/server";
import SetTempPasswordButton from "../brokers/[id]/_components/SetTempPasswordButton";

export default async function AdminUsersPage() {
  const supabase = await createClient();

  const { data: admins } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, display_email, created_at")
    .eq("role", "admin")
    .order("first_name", { ascending: true });

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin Users</h1>
        <p className="text-gray-500 text-sm mt-1">
          Manage admin accounts. Use "Set temp password" if someone is locked out.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {!admins || admins.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">No admin users found.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {admins.map((admin) => {
              const name = admin.first_name
                ? `${admin.first_name} ${admin.last_name ?? ""}`.trim()
                : admin.display_email ?? "—";
              const joined = admin.created_at
                ? new Date(admin.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : null;

              return (
                <li key={admin.id} className="px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{name}</p>
                      <p className="text-sm text-gray-500 mt-0.5">{admin.display_email ?? "—"}</p>
                      {joined && (
                        <p className="text-xs text-gray-400 mt-1">Joined {joined}</p>
                      )}
                    </div>
                    <div className="shrink-0 pt-0.5">
                      <SetTempPasswordButton brokerId={admin.id} />
                    </div>
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
