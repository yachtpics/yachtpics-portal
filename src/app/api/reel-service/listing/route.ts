import { NextRequest, NextResponse } from "next/server";
import { reelServiceCaller } from "@/lib/reelServiceCaller";
import { loadListingReelService } from "@/lib/reelServiceStripe";
import { ANGLE_LABEL, type ReelServiceAngle } from "@/lib/reelService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reel-service/listing?listingId=…[&delivered=1]
 *   → { ready, listingActive, state, billingStatus, currentPeriodEnd,
 *       cancelAtPeriodEnd, deliveredThisMonth, reelsPerBoat, isBroker, delivered? }
 *
 * The Reel Service card on a listing page (broker + admin) and the
 * "Delivered by YachtPics" strip on its Reel page. `state`:
 *   none     — not on the service (offer it)
 *   paid     — paid and running (active / past_due)
 *   paused   — Stripe gave up on payment; off until the card is fixed
 *   comped   — on the service at no charge (admin)
 *   ended    — was on the service, isn't now (offer it again)
 */
export async function GET(req: NextRequest) {
  const listingId = req.nextUrl.searchParams.get("listingId");
  const who = await reelServiceCaller(listingId);
  if (who.error) return who.error;
  const { service, brokerId, userId } = who;

  const [{ data: listing }, st] = await Promise.all([
    service.from("listings").select("status, vessel_name").eq("id", listingId).maybeSingle(),
    loadListingReelService(service, listingId as string, brokerId),
  ]);
  const row = st.row;
  let state: "none" | "paid" | "paused" | "comped" | "ended" = "none";
  if (st.legacy) state = "comped";
  else if (row) {
    if (row.billing_status === "comped") state = row.ended_at ? "ended" : "comped";
    else if (row.billing_status === "active" || row.billing_status === "past_due") state = row.ended_at ? "ended" : "paid";
    else if (row.billing_status === "paused") state = "paused";
    else state = "ended";
  }

  let delivered: { id: string; angle: string; caption: string; deliveredAt: string | null; period: string; slot: number }[] | undefined;
  if (req.nextUrl.searchParams.get("delivered") === "1") {
    const { data } = await service.from("reel_service_jobs")
      .select("id, angle, caption, delivered_at, period, slot")
      .eq("listing_id", listingId).eq("status", "delivered").not("video_path", "is", null)
      .order("delivered_at", { ascending: false }).limit(24);
    delivered = ((data ?? []) as { id: string; angle: string; caption: string | null; delivered_at: string | null; period: string; slot: number }[])
      .map((j) => ({ id: j.id, angle: ANGLE_LABEL[j.angle as ReelServiceAngle] ?? j.angle, caption: j.caption ?? "", deliveredAt: j.delivered_at, period: j.period, slot: j.slot }));
  }

  return NextResponse.json({
    ready: st.ready,
    listingActive: listing?.status === "active",
    state,
    billingStatus: row?.billing_status ?? (st.legacy ? "comped" : null),
    currentPeriodEnd: row?.current_period_end ?? null,
    cancelAtPeriodEnd: !!row?.cancel_at_period_end,
    deliveredThisMonth: st.deliveredThisMonth,
    reelsPerBoat: st.perBoat,
    isBroker: userId === brokerId,
    canBuy: who.canBuy,
    vesselName: (listing?.vessel_name as string | null) ?? null,
    isAdmin: who.isAdmin,
    ...(delivered ? { delivered } : {}),
  }, { headers: { "Cache-Control": "no-store" } });
}
