import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { reelServiceCaller } from "@/lib/reelServiceCaller";
import {
  REEL_SERVICE_KIND,
  ensureBrokerStripeCustomer,
  ensureReelServicePrice,
  loadListingReelService,
  rowBlocksCheckout,
} from "@/lib/reelServiceStripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/reel-service/checkout { listingId } → { url }
 *
 * Starts a Stripe Checkout for the Reel Service on one boat ($179/month,
 * card on file, renews monthly, Stripe Tax). The broker or an assistant of
 * the broker may start it — never an admin on someone else's listing (they
 * copy the pay link or comp the boat); the subscription is
 * always the listing's broker's. Nothing is written here — the boat goes on
 * the service when the webhook sees the paid checkout.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const listingId = body?.listingId;
  const who = await reelServiceCaller(listingId);
  if (who.error) return who.error;
  const { service, brokerId, userId } = who;
  if (!who.canBuy) {
    return NextResponse.json({ error: "Admins can’t buy for a broker — copy the pay link or comp the boat." }, { status: 403 });
  }

  const { data: listing } = await service.from("listings").select("id, status, vessel_name").eq("id", listingId).maybeSingle();
  if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  if (listing.status !== "active") {
    return NextResponse.json({ error: "Reel Service is for active listings. This one isn’t active." }, { status: 400 });
  }

  const state = await loadListingReelService(service, listingId, brokerId);
  if (!state.ready) {
    return NextResponse.json({ error: "Reel Service checkout isn’t available yet." }, { status: 503 });
  }
  if (state.legacy || rowBlocksCheckout(state.row)) {
    return NextResponse.json({ error: "Reel Service is already on for this boat." }, { status: 409 });
  }

  try {
    const [customerId, priceId] = await Promise.all([
      ensureBrokerStripeCustomer(service, brokerId),
      ensureReelServicePrice(),
    ]);
    const origin = req.headers.get("origin") ?? "https://portal.yachtpics.com";
    const metadata = { kind: REEL_SERVICE_KIND, listing_id: listingId as string, broker_id: brokerId, started_by_user: userId };
    const params: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata, description: `Reel Service — ${listing.vessel_name || "listing"}` },
      metadata,
      automatic_tax: { enabled: true },
      // Stripe Tax needs the customer's address; save what Checkout collects.
      customer_update: { address: "auto", name: "auto" },
      billing_address_collection: "auto",
      allow_promotion_codes: true,
      success_url: `${origin}/dashboard/listings/${listingId}?reel_service=started&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/dashboard/listings/${listingId}`,
    };
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(params);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/tax/i.test(msg)) throw e;
      // Stripe Tax isn't set up on the account yet: charge without tax rather than fail.
      console.warn(`[reel-service] checkout without automatic tax (Stripe said: ${msg}). Turn on Stripe Tax in the dashboard.`);
      const { automatic_tax: _tax, customer_update: _cu, ...rest } = params;
      void _tax; void _cu;
      session = await stripe.checkout.sessions.create(rest);
    }
    if (!session.url) return NextResponse.json({ error: "Stripe didn’t return a checkout link." }, { status: 502 });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[reel-service] checkout failed:", e);
    return NextResponse.json({ error: "We couldn’t open checkout just now. Please try again in a moment." }, { status: 500 });
  }
}
