import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import AdminBrokersBrowser, { type BrokerRow } from "./_components/AdminBrokersBrowser";

export default async function AdminBrokersPage() {
  const supabase = await createClient();

  const { data: brokers } = await supabase
    .from("profiles")
    .select(`
      id, first_name, last_name, display_email, phone, created_at, welcomed_at, invited_by, email_bounced_at, email_bounce_reason,
      broker_details(brokerage_name),
      subscriptions(plan, status, trial_ends_at)
    `)
    .eq("role", "broker")
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

  const shaped: BrokerRow[] = (brokers ?? []).map((broker) => {
    const details = broker.broker_details as { brokerage_name: string | null } | { brokerage_name: string | null }[] | null;
    const sub = broker.subscriptions as { plan: string; status: string; trial_ends_at: string | null }[] | null;
    const brokerage = (Array.isArray(details) ? details[0]?.brokerage_name : details?.brokerage_name) ?? "—";
    const status = sub?.[0]?.status ?? "—";
    const trialDays = sub?.[0]?.trial_ends_at
      ? Math.max(0, Math.ceil((new Date(sub[0].trial_ends_at).getTime() - Date.now()) / 86400000))
      : null;
    return {
      id: broker.id as string,
      name: broker.first_name ? `${broker.first_name} ${broker.last_name ?? ""}`.trim() : (broker.display_email ?? "—"),
      brokerage,
      email: broker.display_email ?? null,
      phone: broker.phone ?? null,
      invitedByName: broker.invited_by ? (adminNameById.get(broker.invited_by as string) ?? "—") : "—",
      status,
      trialDays,
      invited: !broker.welcomed_at,
      emailBounced: !!broker.email_bounced_at,
      bounceReason: broker.email_bounce_reason ?? null,
    };
  });

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-display text-ink-900">Brokers</h1>
          <p className="text-ink-500 mt-1 text-sm">{brokers?.length ?? 0} broker accounts.</p>
        </div>
        <Link
          href="/admin/brokers/new"
          className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          + Invite Broker
        </Link>
      </div>

      {(!brokers || brokers.length === 0) ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-16 text-center">
          <p className="text-ink-400 text-sm">No brokers yet.</p>
        </div>
      ) : (
        <AdminBrokersBrowser brokers={shaped} />
      )}
    </div>
  );
}
