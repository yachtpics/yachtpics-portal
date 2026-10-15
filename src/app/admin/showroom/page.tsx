import { requireAdminPage } from "@/lib/requireAdminPage";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import ShowroomBuilder, { type ShowroomBroker, type ShowroomBrokerage } from "./ShowroomBuilder";

export const dynamic = "force-dynamic";

/**
 * Showroom Loop — admin only (Oct 15). One long 16:9 MP4 of a brokerage's (or
 * one broker's) recent boats for the office monitor: pick the source, adjust
 * the boats and photos, render in this browser, download. Nothing is uploaded
 * or stored. Deliberately not in the broker Help page.
 */
export default async function ShowroomPage() {
  await requireAdminPage();
  const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const [{ data: bks }, { data: brs }, { data: dets }] = await Promise.all([
    admin.from("brokerages").select("id, name").order("name"),
    admin.from("profiles").select("id, first_name, last_name, display_email, brokerage_id").eq("role", "broker"),
    admin.from("broker_details").select("id, brokerage_name, brokerage_logo_url, logo_url"),
  ]);
  type Det = { id: string; brokerage_name: string | null; brokerage_logo_url: string | null; logo_url: string | null };
  const detBy: Record<string, Det> = {};
  ((dets ?? []) as Det[]).forEach((d) => { detBy[d.id] = d; });

  const brokerages: ShowroomBrokerage[] = ((bks ?? []) as { id: string; name: string | null }[])
    .map((b) => ({ id: b.id, name: b.name ?? "Brokerage" }));
  const brokerageName: Record<string, string> = {};
  brokerages.forEach((b) => { brokerageName[b.id] = b.name; });

  const brokers: ShowroomBroker[] = ((brs ?? []) as { id: string; first_name: string | null; last_name: string | null; display_email: string | null; brokerage_id: string | null }[])
    .map((b) => {
      const d = detBy[b.id];
      return {
        id: b.id,
        name: [b.first_name, b.last_name].filter(Boolean).join(" ") || b.display_email || "Broker",
        brokerageId: b.brokerage_id,
        brokerageName: (b.brokerage_id ? brokerageName[b.brokerage_id] : null) ?? d?.brokerage_name ?? null,
        brokerageLogoUrl: d?.brokerage_logo_url || null,
        logoUrl: d?.logo_url || null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-display text-ink-900">Showroom Loop</h1>
        <p className="text-ink-500 mt-1 text-sm">
          One long widescreen video of a brokerage&rsquo;s recent boats for the office monitor &mdash; each boat&rsquo;s name, year, length and builder, and the brokerage logo. No prices, no broker names. Rendered in this browser; nothing is uploaded.
        </p>
      </div>
      <ShowroomBuilder brokerages={brokerages} brokers={brokers} />
    </div>
  );
}
