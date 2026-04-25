import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardNav from "./_components/DashboardNav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Fetch profile + subscription
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, role")
    .eq("id", user.id)
    .single();

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan, status, trial_ends_at")
    .eq("broker_id", user.id)
    .single();

  const brokerName =
    profile?.first_name
      ? `${profile.first_name} ${profile.last_name ?? ""}`.trim()
      : user.email ?? "Broker";

  return (
    <div className="flex min-h-screen bg-gray-50">
      <DashboardNav
        brokerName={brokerName}
        plan={subscription?.status ?? "trialing"}
        trialEndsAt={subscription?.trial_ends_at ?? null}
      />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
