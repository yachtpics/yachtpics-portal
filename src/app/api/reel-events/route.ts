import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logReelEvent, REEL_EVENT_KINDS, type ReelEventKind } from "@/lib/reelEvents";

export const runtime = "nodejs";

/**
 * POST /api/reel-events  → record one Reel usage event.
 *
 * Body: { kind, listingId?, shape? }
 *   kind   render | download | send_to_phone | copy_caption | added_to_listing
 *   shape  only meaningful on a render: what was made
 *
 * The broker is resolved server-side from the listing rather than taken from
 * the body, so a row can't be attributed to someone it doesn't belong to. The
 * response is always 200-ish and empty of meaning — the page fires this and
 * forgets it; nothing the broker sees depends on the answer.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const kind = body?.kind as ReelEventKind;
  if (!REEL_EVENT_KINDS.includes(kind)) {
    return NextResponse.json({ error: "Bad kind" }, { status: 400 });
  }

  const listingId = typeof body?.listingId === "string" ? body.listingId : null;
  const shape = kind === "render" && body?.shape && typeof body.shape === "object"
    ? body.shape
    : undefined;

  await logReelEvent({ userId: user.id, kind, listingId, shape });

  return NextResponse.json({ success: true });
}
