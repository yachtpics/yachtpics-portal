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
    .select("first_name, last_name, role, welcomed_at, is_brokerage_admin, brokerage_id")
    .eq("id", user.id)
    .single();

  // Gallery clients don't belong in the broker dashboard
  if (profile?.role === "client") redirect("/client");

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

  // Start the 30-day trial on first login: if this broker's trial hasn't been
  // seeded yet (trial_ends_at is null) and they aren't already paying, start it now.
  let trialEndsAt = subscription?.trial_ends_at ?? null;
  if (
    role === "broker" &&
    subscription &&
    !trialEndsAt &&
    subscription.status !== "active" &&
    !subscription.stripe_subscription_id
  ) {
    const newEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    // Only set when still null, so a race can't shorten an already-started trial.
    await serviceClient
      .from("subscriptions")
      .update({ trial_ends_at: newEnd })
      .eq("broker_id", user.id)
      .is("trial_ends_at", null);
    trialEndsAt = newEnd;
  }

  const effectiveSubscription = subscription
    ? { ...subscription, trial_ends_at: trialEndsAt }
    : null;
  let accessStatus = role === "broker" ? getAccessStatus(effectiveSubscription) : "active";

  // A broker whose office (brokerage) carries an active Office plan is unlocked,
  // regardless of their own trial status.
  if (role === "broker" && accessStatus !== "active" && profile?.brokerage_id) {
    const svc = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: office } = await svc
      .from("brokerages")
      .select("subscription_status")
      .eq("id", profile.brokerage_id)
      .single();
    if (office && (office.subscription_status === "active" || office.subscription_status === "trialing")) {
      accessStatus = "active";
    }
  }

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
        trialEndsAt={trialEndsAt}
        accessStatus={accessStatus}
        isBrokerageAdmin={profile?.is_brokerage_admin ?? false}
      />
      <main className="flex-1 overflow-auto pb-20 md:pb-0 pt-12 md:pt-0">
        {role === "broker" && (
          <TrialBanner accessStatus={accessStatus} trialEndsAt={trialEndsAt} />
        )}
        {children}
      </main>
    </div>
  );
}
