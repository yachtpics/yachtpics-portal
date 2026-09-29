import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { claimedRenders, reelsUnlimited, remainingOf, REELS_PER_LISTING } from "@/lib/reelAllowance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Reel allowance — see src/lib/reelAllowance.ts for the policy.
 *
 * GET  /api/reels/claim?listingId=   → { unlimited, used, remaining }
 *   Drives the "Included with this listing: N of 2 left" line.
 *
 * POST /api/reels/claim  { listingId, renderId }
 *   Called before every take-action on the Reel page (download, send to my
 *   phone, save to camera roll, add to listing).
 *   → 200 { ok: true, unlimited: true }        subscriber / admin / open house; nothing recorded
 *   → 200 { ok: true, remaining }              this render is (now, or already) one of the two
 *   → 402 { ok: false, remaining: 0 }          both used, and this is a new render
 *
 * Access is the same set of people who can use the Reel page's take-actions:
 * the broker, a linked assistant, an admin, a co-broker (Send to my phone
 * already allows them) and a brokerage admin (RLS lets them open the page).
 */

const RENDER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function authorise(listingId: string) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const svc = service();
  const access = await assertListingAccess(svc, listingId, user.id, { includeCoBroker: true, includeBrokerageAdmin: true });
  if (access instanceof NextResponse) return access;
  return { svc, userId: user.id, brokerId: access.brokerId };
}

export async function GET(req: NextRequest) {
  const listingId = new URL(req.url).searchParams.get("listingId");
  if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 });
  const a = await authorise(listingId);
  if (a instanceof NextResponse) return a;

  try {
    const { unlimited } = await reelsUnlimited(a.svc, { userId: a.userId, brokerId: a.brokerId });
    if (unlimited) return NextResponse.json({ unlimited: true, used: 0, remaining: null });
    const used = (await claimedRenders(a.svc, listingId)).length;
    return NextResponse.json({ unlimited: false, used, remaining: remainingOf(used), included: REELS_PER_LISTING });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read the allowance." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const listingId = typeof body?.listingId === "string" ? body.listingId : null;
  const renderId = typeof body?.renderId === "string" ? body.renderId : null;
  if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 });
  if (!renderId || !RENDER_ID_RE.test(renderId)) return NextResponse.json({ error: "Bad renderId" }, { status: 400 });

  const a = await authorise(listingId);
  if (a instanceof NextResponse) return a;

  try {
    const { unlimited, role } = await reelsUnlimited(a.svc, { userId: a.userId, brokerId: a.brokerId });
    if (unlimited) return NextResponse.json({ ok: true, unlimited: true });

    const claimed = await claimedRenders(a.svc, listingId);
    if (claimed.indexOf(renderId) !== -1) {
      return NextResponse.json({ ok: true, unlimited: false, remaining: remainingOf(claimed.length) });
    }
    if (claimed.length >= REELS_PER_LISTING) {
      return NextResponse.json({ ok: false, unlimited: false, remaining: 0 }, { status: 402 });
    }

    const { error } = await a.svc.from("reel_events").insert({
      kind: "claim",
      listing_id: listingId,
      broker_id: a.brokerId,
      user_id: a.userId,
      role,
      render_id: renderId,
    });
    // 23505: the same render was claimed a moment ago (another tab, a double
    // click). That's the idempotent case, not a failure.
    if (error && error.code !== "23505") throw new Error(error.message);

    // Settle a race. Two different renders can both pass the check above
    // (two tabs, the last reel). Re-read in creation order: only the first two
    // renders are included; a later one takes its row back out and is refused.
    const after = await claimedRenders(a.svc, listingId);
    if (after.slice(0, REELS_PER_LISTING).indexOf(renderId) === -1) {
      await a.svc.from("reel_events").delete()
        .eq("listing_id", listingId).eq("kind", "claim").eq("render_id", renderId);
      return NextResponse.json({ ok: false, unlimited: false, remaining: 0 }, { status: 402 });
    }
    return NextResponse.json({ ok: true, unlimited: false, remaining: remainingOf(after.length) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't record the reel." }, { status: 500 });
  }
}
