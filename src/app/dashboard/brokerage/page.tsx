import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import BrokerageTeam from "./_components/BrokerageTeam";

export const dynamic = "force-dynamic";

export default async function BrokerageTeamPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_brokerage_admin, brokerage_id")
    .eq("id", user.id)
    .single();

  if (!profile?.is_brokerage_admin || !profile.brokerage_id) redirect("/dashboard");

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: brokerage } = await service.from("brokerages").select("name").eq("id", profile.brokerage_id).single();

  const { data: membersRaw } = await service
    .from("profiles")
    .select("id, first_name, last_name, display_email, role")
    .eq("brokerage_id", profile.brokerage_id)
    .in("role", ["broker", "assistant"])
    .order("last_name");

  const members = (membersRaw ?? []).map((p) => ({
    id: p.id,
    name: p.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : (p.display_email ?? "—"),
    email: p.display_email as string | null,
    role: p.role as string,
  }));

  return <BrokerageTeam brokerageName={brokerage?.name ?? "Your brokerage"} members={members} />;
}
