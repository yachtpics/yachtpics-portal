import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import DashboardNav from "./_components/DashboardNav";
import TrialBanner from "./_components/TrialBanner";
import { getAccessStatus } from "@/lib/subscriptionAccess";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Fetch profile + subscription
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, role, welcomed_at")
    .eq("id", user.id)
    .single();

  // Send welcome email on first login (welcomed_at is null)
  if (profile && !profile.welcomed_at) {
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    // Stamp immediately to prevent double-sending
    await serviceClient
      .from("profiles")
      .update({ welcomed_at: new Date().toISOString() })
      .eq("id", user.id);
    // Fire welcome email (non-blocking failure — if it fails, we don't crash the app)
    fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.yachtpics.com"}/api/email/welcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    }).catch(() => {});
  }

  const role = profile?.role ?? "broker";

  const { data: subscription } = role === "broker"
    ? await supabase.from("subscriptions").select("plan, status, trial_ends_at, stripe_subscription_id").eq("broker_id", user.id).single()
    : { data: null };

  const accessStatus = role === "broker" ? getAccessStatus(subscription ?? null) : "active";

  const userName =
    profile?.first_name
      ? `${profile.first_name} ${profile.last_name ?? ""}`.trim()
      : user.email ?? "User";

  return (
    <div className="flex min-h-screen bg-gray-50">
      <DashboardNav
        brokerName={userName}
        role={role}
        plan={subscription?.status ?? "trialing"}
        trialEndsAt={subscription?.trial_ends_at ?? null}
        accessStatus={accessStatus}
      />
      <main className="flex-1 overflow-auto pb-20 md:pb-0 pt-12 md:pt-0">
        {role === "broker" && (
          <TrialBanner accessStatus={accessStatus} trialEndsAt={subscription?.trial_ends_at ?? null} />
        )}
        {children}
      </main>
    </div>
  );
}
