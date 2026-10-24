import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { reelServiceCaller } from "@/lib/reelServiceCaller";
import { loadListingReelService, syncReelServiceSubscription } from "@/lib/reelServiceStripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/reel-service/cancel { listingId } → { ok, endsAt }
 *
 * Cancel the Reel Service on one boat: Stripe stops renewing it and it runs
 * to the end of the paid month (cancel_at_period_end). The broker, their
 * assistant or an admin may cancel. Comped boats are taken off by an admin
 * on the broker page instead.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const listingId = body?.listingId;
  const who = await reelServiceCaller(listingId);
  if (who.error) return who.error;
  const { service, brokerId } = who;

  const state = await loadListingReelService(service, listingId, brokerId);
  const row = state.row;
  if (!state.ready || !row || !row.stripe_subscription_id || row.billing_status === "canceled" || row.billing_status === "comped") {
    return NextResponse.json({ error: "There’s no paid Reel Service to cancel on this boat." }, { status: 400 });
  }
  try {
    const sub = await stripe.subscriptions.update(row.stripe_subscription_id, { cancel_at_period_end: true });
    await syncReelServiceSubscription(service, sub);
    const end = (sub as unknown as { current_period_end?: number }).current_period_end;
    return NextResponse.json({ ok: true, endsAt: end ? new Date(end * 1000).toISOString() : row.current_period_end });
  } catch (e) {
    console.error("[reel-service] cancel failed:", e);
    return NextResponse.json({ error: "We couldn’t cancel just now. Please try again in a moment." }, { status: 500 });
  }
}
