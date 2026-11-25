import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { demoGuard } from "@/lib/demoServer";
import { takeCoverSlot } from "@/lib/officeCoverSlots";

export const runtime = "nodejs";

/**
 * POST /api/listings/[id]/cover-slot — the first paid ACTION on a boat that a
 * paying company admin's plan can cover (src/lib/officeCoverSlots.ts). The
 * listing page and the social post page call this right before a paid tool
 * whose work happens in the browser (upload photos / videos / documents,
 * replace a photo, create the slideshow, copy or share its link, download a
 * social post). The action goes ahead only if this answers ok.
 *
 * Idempotent: a boat that already holds a slot, or doesn't need one (own
 * plan, Office plan, Reel Service), answers ok and changes nothing. Only the
 * paying admin, her own assistant or a YachtPics admin can take a slot; for
 * anyone else, or when the plan's slots are all in use, a 403 with a plain
 * sentence the page shows until dismissed.
 *
 *   → 200 { ok: true, state: "taken" | "held" | "notNeeded" }
 *   → 403 { ok: false, error }
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Your session has ended. Please sign in again." }, { status: 401 });
  // Read-only demo (layer 3 — src/lib/demo.ts). The demo boats are covered
  // by their own accounts, so the page never calls this for them.
  { const demo = demoGuard(user); if (demo) return demo; }

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // Anyone who can act on the listing may ask; takeCoverSlot decides whether
  // THEY can take a slot (admin side only).
  const access = await assertListingAccess(svc, params.id, user.id, { includeCoBroker: true });
  if (access instanceof NextResponse) return access;

  try {
    const r = await takeCoverSlot(svc, params.id, user.id);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, state: r.state });
  } catch (err) {
    console.error("[cover-slot] take failed:", err);
    return NextResponse.json({ ok: false, error: "The plan couldn't be checked just now. Try again in a moment." }, { status: 500 });
  }
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
