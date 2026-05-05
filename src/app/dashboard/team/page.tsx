import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import TeamPanel from "./_components/TeamPanel";

export default async function TeamPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // Assistants don't have a team page
  if (profile?.role !== "broker") redirect("/dashboard");

  const { data: assistants } = await supabase
    .from("broker_assistants")
    .select("assistant_id, profiles:assistant_id(id, first_name, last_name, display_email)")
    .eq("broker_id", user.id);

  const assistantList = (assistants ?? []).map((a) => {
    const p = a.profiles as { id: string; first_name: string | null; last_name: string | null; display_email: string | null } | null;
    return {
      id: a.assistant_id as string,
      name: p?.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : null,
      email: p?.display_email ?? null,
    };
  });

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <p className="text-gray-500 text-sm mt-1">
          Assistants have full access to your listings — they can upload photos, manage content, and send slideshows to clients on your behalf.
        </p>
      </div>
      <TeamPanel brokerId={user.id} initialAssistants={assistantList} />
    </div>
  );
}
