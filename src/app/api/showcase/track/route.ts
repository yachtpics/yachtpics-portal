import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logShowcaseEvent } from "@/lib/showcaseEvents";

export const runtime = "nodejs";

// POST /api/showcase/track  → record a Recently Photographed usage event.
// Body: { kind: "page_open" | "contact_click", listingId?, detail? }
// (boat_view is recorded server-side in the photos route.)
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const kind = body?.kind;
  if (kind !== "page_open" && kind !== "contact_click") {
    return NextResponse.json({ error: "Bad kind" }, { status: 400 });
  }

  const listingId = typeof body?.listingId === "string" ? body.listingId : null;
  const detail = body?.detail === "phone" || body?.detail === "email" ? body.detail : null;

  await logShowcaseEvent({
    userId: user.id,
    kind,
    listingId,
    detail,
    // Throttle page opens so a refresh doesn't inflate the count; count every
    // contact click (each is a real intent signal).
    throttleMinutes: kind === "page_open" ? 30 : 0,
  });

  return NextResponse.json({ success: true });
}
