import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { REEL_SERVICE_PRICE, REEL_SERVICE_REELS_PER_BOAT } from "@/lib/plans";
import { reelServiceRowInService } from "@/lib/reelService";
import ReelServiceAddButton from "./ReelServiceAddButton";

export const dynamic = "force-dynamic";

/**
 * /dashboard/reel-service — where the /rs boat-show QR lands after sign-in
 * (Oct 24). Every active listing of the broker (an assistant: of the brokers
 * they work for) with "Add — $179/mo" (→ Stripe Checkout) or a badge for the
 * boats already on the service.
 */
export default async function ReelServicePickPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=/dashboard/reel-service");

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = me?.role ?? "broker";

  let brokerIds: string[] = [user.id];
  if (role === "assistant") {
    const { data: links } = await svc.from("broker_assistants").select("broker_id").eq("assistant_id", user.id);
    brokerIds = ((links ?? []) as { broker_id: string }[]).map((l) => l.broker_id);
  }

  type L = { id: string; broker_id: string; vessel_name: string | null; year: number | null; length_ft: number | null; make: string | null; model: string | null };
  let listings: L[] = [];
  let ready = true;
  const status: Record<string, "paid" | "comped" | "past_due" | "paused" | "ending"> = {};
  if (role !== "admin" && brokerIds.length) {
    const { data } = await svc.from("listings")
      .select("id, broker_id, vessel_name, year, length_ft, make, model")
      .in("broker_id", brokerIds).eq("status", "active").order("vessel_name");
    listings = (data ?? []) as L[];
    const { data: rows, error } = await svc.from("reel_service_listings")
      .select("listing_id, broker_id, ended_at, billing_status, cancel_at_period_end").in("broker_id", brokerIds);
    if (error) ready = false;
    const rs = (rows ?? []) as { listing_id: string; broker_id: string; ended_at: string | null; billing_status: string; cancel_at_period_end: boolean }[];
    rs.forEach((r) => {
      if (r.billing_status === "paused" && !r.ended_at) status[r.listing_id] = "paused";
      else if (!reelServiceRowInService(r)) return;
      else if (r.billing_status === "comped") status[r.listing_id] = "comped";
      else if (r.billing_status === "past_due") status[r.listing_id] = "past_due";
      else status[r.listing_id] = r.cancel_at_period_end ? "ending" : "paid";
    });
    // Enrolled before per-boat rows existed: every active boat is on the service.
    if (ready) {
      const { data: subs } = await svc.from("reel_service_subscriptions").select("broker_id").in("broker_id", brokerIds).eq("enabled", true);
      ((subs ?? []) as { broker_id: string }[]).forEach((s) => {
        if (!rs.some((r) => r.broker_id === s.broker_id)) listings.filter((l) => l.broker_id === s.broker_id).forEach((l) => { status[l.id] = "comped"; });
      });
    }
  }

  const label: Record<string, string> = {
    paid: "Reel Service active",
    comped: "Reel Service active",
    past_due: "Active · payment problem",
    paused: "Paused · update your card",
    ending: "Active · ends at the end of this month’s billing",
  };

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <h1 className="text-display text-ink-900">Reel Service</h1>
      <p className="text-ink-500 mt-1 text-sm max-w-2xl">
        Up to {REEL_SERVICE_REELS_PER_BOAT} social reels a month for a listing, made by YachtPics from the shoot &mdash; photos, plus drone and video when the boat has them.
        ${REEL_SERVICE_PRICE} a month per boat, paid by card. Cancel anytime from the boat&rsquo;s page.
      </p>

      {role === "admin" ? (
        <p className="mt-6 text-sm text-ink-600">Admins: open a listing to add the Reel Service for its broker, or comp boats on the broker&rsquo;s page.</p>
      ) : !ready ? (
        <p className="mt-6 text-sm text-ink-500">Reel Service isn&rsquo;t available to order here yet.</p>
      ) : listings.length === 0 ? (
        <p className="mt-6 text-sm text-ink-500">No active listings yet. Once a boat is listed in the Portal, you can add the Reel Service here.</p>
      ) : (
        <ul className="mt-6 bg-white border border-hairline rounded-card shadow-elev-1 divide-y divide-hairline">
          {listings.map((l) => {
            const name = l.vessel_name || [l.year, l.make, l.model].filter(Boolean).join(" ") || "Listing";
            const detail = [l.year, l.length_ft ? `${Math.round(Number(l.length_ft))}′` : null, l.make, l.model].filter(Boolean).join(" ");
            const st = status[l.id];
            return (
              <li key={l.id} className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <Link href={`/dashboard/listings/${l.id}`} className="text-sm font-semibold text-ink-900 hover:underline">{name}</Link>
                  {detail && <p className="text-xs text-ink-500">{detail}</p>}
                </div>
                {st ? (
                  <Link href={`/dashboard/listings/${l.id}`}
                    className={`text-xs font-semibold px-2 py-1 rounded ${st === "paused" ? "bg-danger-50 text-danger-700" : st === "past_due" ? "bg-warn-50 text-warn-800" : "bg-success-50 text-success-700"}`}>
                    {label[st]}
                  </Link>
                ) : (
                  <ReelServiceAddButton listingId={l.id} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-6 text-xs text-ink-500">Reels land on <Link href="/dashboard/reels" className="text-accent-700 hover:underline">Your Reels</Link> and in your inbox.</p>
    </div>
  );
}
