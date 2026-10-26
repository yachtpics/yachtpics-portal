import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { resolveActingBroker, serviceClient } from "@/lib/brokerSiteServer";
import { readSiteBilling, revalidateSite, subscriptionPeriodEnd, syncWebsiteFromPlanSubscription, websiteItemOf } from "@/lib/websiteAddon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/website/remove → { ok, endsAt }
 *
 * Takes the website line off the broker's plan. Stripe can't schedule an
 * item's removal for the period end, so:
 *   1. broker_sites.website_ends_at = the subscription's current period end
 *      (written FIRST, so the site never blinks offline in between);
 *   2. the item is deleted at once with proration_behavior "none" — no credit,
 *      no charge, and the next renewal doesn't include it;
 *   3. the site stays live until website_ends_at (websiteEntitlement).
 * No cron involved. Re-adding before then clears website_ends_at.
 * Broker only (billing changes are the broker's own).
 */
export async function POST(req: NextRequest) {
  const who = await resolveActingBroker(req.nextUrl.searchParams.get("brokerId"));
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  if (!(who.role === "broker" && who.brokerId === who.userId)) {
    return NextResponse.json({ error: "Only the broker can change their plan." }, { status: 403 });
  }
  const svc = serviceClient();
  const brokerId = who.brokerId;
  const { ready, row } = await readSiteBilling(svc, brokerId);
  if (!ready || !row?.website_item_id || !row.stripe_subscription_id) {
    return NextResponse.json({ error: "The website isn’t on your plan." }, { status: 400 });
  }
  try {
    const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const item = websiteItemOf(sub);
    const endsAt = subscriptionPeriodEnd(sub) ?? row.current_period_end;
    if (!endsAt) return NextResponse.json({ error: "We couldn’t read your billing date. Please try again." }, { status: 500 });

    await svc.from("broker_sites").update({ website_ends_at: endsAt, updated_at: new Date().toISOString() }).eq("broker_id", brokerId);
    if (item) {
      try {
        await stripe.subscriptionItems.del(item.id, { proration_behavior: "none" });
      } catch (e) {
        await svc.from("broker_sites").update({ website_ends_at: null }).eq("broker_id", brokerId);
        throw e;
      }
    }
    const fresh = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    await syncWebsiteFromPlanSubscription(svc, fresh, brokerId);
    revalidateSite(row.slug);
    return NextResponse.json({ ok: true, endsAt });
  } catch (e) {
    console.error("[website] remove failed:", e);
    return NextResponse.json({ error: "We couldn’t remove the website just now. Please try again in a moment." }, { status: 500 });
  }
}
