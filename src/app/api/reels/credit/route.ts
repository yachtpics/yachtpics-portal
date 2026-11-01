import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/publicSlideshow";
import { resolveReelCredit } from "@/lib/reelCredit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reels/credit?listingId=…[&brokerId=…]
 * The broker a listing reel credits for the signed-in user, with their card
 * and colours (src/lib/reelCredit.ts). brokerId is honoured for admins only,
 * and only when it's the owner or a co-broker of the listing.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const listingId = url.searchParams.get("listingId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(listingId)) return NextResponse.json({ error: "listingId required" }, { status: 400 });
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const credit = await resolveReelCredit(serviceClient(), listingId, user.id, url.searchParams.get("brokerId"));
  if (!credit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(credit, { headers: { "Cache-Control": "no-store" } });
}
