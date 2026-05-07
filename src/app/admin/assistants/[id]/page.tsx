import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import AssistantBrokerPanel from "./_components/AssistantBrokerPanel";
import DeleteAssistantButton from "./_components/DeleteAssistantButton";

export default async function AdminAssistantDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();

  const { data: assistant } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, display_email, created_at, role")
    .eq("id", params.id)
    .single();

  if (!assistant || assistant.role !== "assistant") notFound();

  const { data: links } = await supabase
    .from("broker_assistants")
    .select("broker_id, profiles:broker_id(id, first_name, last_name, display_email)")
    .eq("assistant_id", params.id);

  const linkedBrokers = (links ?? []).map((l) => {
    const p = l.profiles as unknown as { id: string; first_name: string | null; last_name: string | null; display_email: string | null } | null;
    return {
      id: l.broker_id as string,
      name: p?.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : p?.display_email ?? "Unknown",
      email: p?.display_email ?? null,
    };
  });

  const { data: allBrokers } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, display_email")
    .eq("role", "broker")
    .order("last_name", { ascending: true });

  const brokerOptions = (allBrokers ?? []).map((b) => ({
    id: b.id,
    name: b.first_name ? `${b.first_name} ${b.last_name ?? ""}`.trim() : b.display_email ?? "Unknown",
    email: b.display_email ?? null,
  }));

  const displayName = assistant.first_name
    ? `${assistant.first_name} ${assistant.last_name ?? ""}`.trim()
    : assistant.display_email ?? "Assistant";

  const joinedDate = new Date(assistant.created_at).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <Link href="/admin/assistants" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">
          &larr; Back to Assistants
        </Link>
        <div className="mt-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>
            <p className="text-gray-500 mt-0.5 text-sm">{assistant.display_email ?? "No email"}</p>
            <p className="text-gray-400 text-xs mt-1">Account created {joinedDate}</p>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-purple-50 text-purple-700">
              Assistant
            </span>
            <DeleteAssistantButton assistantId={params.id} displayName={displayName} />
          </div>
        </div>
      </div>

      <AssistantBrokerPanel
        assistantId={params.id}
        linkedBrokers={linkedBrokers}
        brokerOptions={brokerOptions}
      />
    </div>
  );
}
