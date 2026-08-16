import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import DeleteBrokerButton from "./DeleteBrokerButton";
import AssistantsPanel from "./_components/AssistantsPanel";
import ResendInviteButton from "./_components/ResendInviteButton";
import SetTempPasswordButton from "./_components/SetTempPasswordButton";
import BrokerContactEditor from "./_components/BrokerContactEditor";
import AddedByEditor from "./_components/AddedByEditor";
import BrokerListingsPublisher from "./_components/BrokerListingsPublisher";

export default async function AdminBrokerDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { invited?: string } }) {
  const supabase = await createClient();

  const [{ data: profile }, { data: details }, { data: subscription }, { data: listings }, { data: shoots }, { data: assistants }, { data: adminProfiles }, { data: sitePages }] =
    await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name, display_email, phone, created_at, invited_by, email_bounced_at, email_bounce_reason").eq("id", params.id).single(),
      supabase.from("broker_details").select("*").eq("id", params.id).single(),
      supabase.from("subscriptions").select("plan, status, trial_ends_at, current_period_end").eq("broker_id", params.id).single(),
      supabase.from("listings").select("id, vessel_name, vessel_type, year, length_ft, location, status, updated_at, publish_to_site, site_page, showcase_opt_out").eq("broker_id", params.id).order("updated_at", { ascending: false }),
      supabase.from("shoots").select("id, shoot_date, amount_cents, payment_status, invoice_number, listings:listing_id(vessel_name)").eq("broker_id", params.id).order("shoot_date", { ascending: false }).limit(10),
      supabase.from("broker_assistants").select("assistant_id, profiles:assistant_id(id, first_name, last_name, display_email)").eq("broker_id", params.id),
      supabase.from("profiles").select("id, first_name, last_name").eq("role", "admin").order("first_name", { ascending: true }),
      supabase.from("site_pages").select("label, filename").eq("is_active", true).order("label"),
    ]);

  if (!profile) notFound();

  const name = profile.first_name ? `${profile.first_name} ${profile.last_name ?? ""}`.trim() : profile.display_email ?? "Broker";
  const trialDays = subscription?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null;

  const admins = (adminProfiles ?? []).map((a) => ({
    id: a.id as string,
    name: a.first_name ? `${a.first_name} ${a.last_name ?? ""}`.trim() : "Admin",
  }));

  const assistantList = (assistants ?? []).map((a) => {
    const p = (a.profiles as unknown as { id: string; first_name: string | null; last_name: string | null; display_email: string | null } | null);
    return {
      id: a.assistant_id as string,
      name: p?.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : null,
      email: p?.display_email ?? null,
    };
  });

  // Who added this broker — resolved for ANY role (admin, assistant, brokerage
  // admin, or another broker), so it isn't just shown as "Unassigned".
  let inviter: { id: string; name: string; role: string } | null = null;
  if (profile.invited_by) {
    const { data: inv } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, display_email, role")
      .eq("id", profile.invited_by)
      .single();
    if (inv) {
      const roleRaw = (inv.role as string) ?? "";
      inviter = {
        id: inv.id as string,
        name: inv.first_name ? `${inv.first_name} ${inv.last_name ?? ""}`.trim() : (inv.display_email ?? "Unknown"),
        role: roleRaw ? roleRaw.charAt(0).toUpperCase() + roleRaw.slice(1) : "",
      };
    }
  }

  // Listings this broker co-brokers (owned by someone else).
  const { data: coBrokeredRows } = await supabase
    .from("listing_co_brokers")
    .select("listing_id, listings:listing_id(id, vessel_name, status, profiles:broker_id(first_name, last_name, display_email))")
    .eq("broker_id", params.id);
  const coBrokered = (coBrokeredRows ?? []).map((r) => {
    const l = r.listings as unknown as { id: string; vessel_name: string | null; status: string; profiles: { first_name: string | null; last_name: string | null; display_email: string | null } | null } | null;
    const owner = l?.profiles;
    return {
      id: l?.id ?? (r.listing_id as string),
      vessel_name: l?.vessel_name ?? "Untitled",
      status: l?.status ?? "—",
      ownerName: owner?.first_name ? `${owner.first_name} ${owner.last_name ?? ""}`.trim() : (owner?.display_email ?? "—"),
    };
  });

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/admin/brokers" className="text-ink-400 hover:text-ink-600 text-sm transition-colors duration-fast ease-quiet">
          ← All brokers
        </Link>
        <div className="flex items-start justify-between mt-1">
          <div>
            <h1 className="text-display text-ink-900">{name}</h1>
            <p className="text-ink-500 text-sm mt-0.5">{details?.brokerage_name ?? "No brokerage"}</p>
          </div>
          <Link
            href={`/admin/shoots/new?broker=${params.id}`}
            className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            + New Invoice
          </Link>
        </div>
      </div>

      {searchParams.invited === "true" && (
        <div className="mb-6 flex items-start gap-3 bg-success-50 border border-success-200 rounded-card px-5 py-4">
          <span className="text-success-600 text-lg leading-none mt-0.5">✓</span>
          <div>
            <p className="text-sm font-semibold text-success-700">All done — broker account created</p>
            <p className="text-sm text-success-700 mt-0.5">
              {name} received an email with their login credentials. You can resend or reset their password below if needed.
            </p>
          </div>
        </div>
      )}

      {profile.email_bounced_at && (
        <div className="mb-6 flex items-start gap-3 bg-danger-50 border border-danger-200 rounded-card px-5 py-4">
          <span className="text-danger-600 text-lg leading-none mt-0.5">⚠</span>
          <div>
            <p className="text-sm font-semibold text-danger-700">This broker&rsquo;s email is bouncing</p>
            <p className="text-sm text-danger-700 mt-0.5">
              Emails to <strong>{profile.display_email}</strong> aren&rsquo;t being delivered{profile.email_bounce_reason ? ` — ${profile.email_bounce_reason}` : ""}. Update their email below to the correct address; that clears this warning and re-enables delivery.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {/* Contact */}
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
          <BrokerContactEditor
            brokerId={params.id}
            firstName={profile.first_name}
            lastName={profile.last_name}
            email={profile.display_email}
            phone={profile.phone}
          />
          {details?.brokerage_address && (
            <p className="text-sm text-ink-500 mt-1">
              {details.brokerage_address}, {details.brokerage_city ?? ""} {details.brokerage_state ?? ""}
            </p>
          )}
          {details?.license_number && (
            <p className="text-xs text-ink-500 mt-2">License: {details.license_number}</p>
          )}
          <div className="mt-3 pt-3 border-t border-hairline flex flex-col gap-2">
            <ResendInviteButton brokerId={params.id} />
            <SetTempPasswordButton brokerId={params.id} />
          </div>
          <div className="mt-3 pt-3 border-t border-hairline">
            <AddedByEditor brokerId={params.id} admins={admins} initialAdminId={profile.invited_by ?? null} initialInviter={inviter} />
          </div>
        </div>

        {/* Subscription */}
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
          <p className="label-caps mb-3">Subscription</p>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
            subscription?.status === "active" ? "bg-success-50 text-success-700 border-success-200"
            : subscription?.status === "trialing" ? "bg-warn-50 text-warn-700 border-warn-200"
            : "bg-ink-100 text-ink-600 border-hairline"
          }`}>
            {subscription?.status === "trialing" && trialDays !== null
              ? `Trial · ${trialDays} day${trialDays !== 1 ? "s" : ""} left`
              : subscription?.status ?? "—"}
          </span>
          <p className="text-sm text-ink-500 mt-2 capitalize">Plan: {subscription?.plan ?? "free"}</p>
          {subscription?.current_period_end && (
            <p className="text-xs text-ink-500 mt-1 tabular-nums">
              Renews {new Date(subscription.current_period_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
          <p className="label-caps mb-3">Activity</p>
          <p className="text-sm text-ink-900"><span className="text-2xl font-light tabular-nums">{listings?.length ?? 0}</span> listings</p>
          <p className="text-sm text-ink-500 mt-1"><span className="font-semibold text-ink-900 tabular-nums">{shoots?.length ?? 0}</span> shoots on record</p>
          <p className="text-xs text-ink-500 mt-2">
            Member since {new Date(profile.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "America/New_York" })}
          </p>
        </div>
      </div>

      {/* Assistants */}
      <AssistantsPanel brokerId={params.id} initialAssistants={assistantList} />

      {/* Listings */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 mb-6">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <h2 className="text-h2 text-ink-900">Listings ({listings?.length ?? 0})</h2>
          <Link href={`/admin/listings/new?broker=${params.id}`} className="text-accent-700 hover:text-accent-800 text-sm font-medium transition-colors duration-fast ease-quiet">
            + New listing
          </Link>
        </div>
        {!listings || listings.length === 0 ? (
          <div className="py-10 text-center text-ink-400 text-sm">No listings yet.</div>
        ) : (
          <BrokerListingsPublisher listings={listings} sitePages={sitePages ?? []} />
        )}
      </div>

      {/* Co-brokered listings (owned by another broker) */}
      {coBrokered.length > 0 && (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 mb-6">
          <div className="px-6 py-4 border-b border-hairline">
            <h2 className="text-h2 text-ink-900">Co-brokered Listings ({coBrokered.length})</h2>
            <p className="text-xs text-ink-500 mt-0.5">Boats owned by another broker that this broker shares access to.</p>
          </div>
          <ul className="divide-y divide-hairline">
            {coBrokered.map((l) => (
              <li key={l.id} className="px-6 py-4 flex items-center justify-between hover:bg-ink-50 transition-colors duration-fast ease-quiet">
                <div>
                  <p className="text-sm font-medium text-ink-900">{l.vessel_name}</p>
                  <p className="text-xs text-ink-500 mt-0.5">Owned by {l.ownerName}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-info-50 text-info-700 border border-info-200 uppercase tracking-wide">Co-broker</span>
                  <Link href={`/admin/listings/${l.id}?from=broker`} className="text-accent-700 hover:text-accent-800 text-xs font-medium transition-colors duration-fast ease-quiet">
                    Manage →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Shoot history */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 mb-6">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <h2 className="text-h2 text-ink-900">Shoot History</h2>
          <Link href={`/admin/shoots/new?broker=${params.id}`} className="text-accent-700 hover:text-accent-800 text-sm font-medium transition-colors duration-fast ease-quiet">
            + New invoice
          </Link>
        </div>
        {!shoots || shoots.length === 0 ? (
          <div className="py-10 text-center text-ink-400 text-sm">No shoots on record.</div>
        ) : (
          <ul className="divide-y divide-hairline">
            {shoots.map((shoot) => {
              const vessel = (shoot.listings as { vessel_name: string | null }[] | null)?.[0]?.vessel_name ?? "—";
              const amount = shoot.amount_cents
                ? `$${(shoot.amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                : "—";
              const date = shoot.shoot_date
                ? new Date(shoot.shoot_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : "—";
              return (
                <li key={shoot.id} className="px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink-900">{vessel}</p>
                    <p className="text-xs text-ink-500 mt-0.5 tabular-nums">{date} · {shoot.invoice_number ?? "No invoice #"}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-sm font-medium text-ink-900 tabular-nums">{amount}</p>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                      shoot.payment_status === "paid" ? "bg-success-50 text-success-700 border-success-200"
                      : shoot.payment_status === "cancelled" ? "bg-ink-100 text-ink-600 border-hairline"
                      : "bg-warn-50 text-warn-700 border-warn-200"
                    }`}>{shoot.payment_status}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Danger zone */}
      <div className="border border-danger-200 rounded-card px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-danger-700">Delete broker</p>
          <p className="text-xs text-ink-500 mt-0.5">Permanently removes this broker and all associated data. This cannot be undone.</p>
        </div>
        <DeleteBrokerButton brokerId={params.id} brokerName={name} />
      </div>

    </div>
  );
}