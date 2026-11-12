import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { isAiConfigured } from "@/lib/ai";
import { labelListingPhotos } from "@/lib/labelPhotos";
import { demoGuard, demoRwOwnListing } from "@/lib/demoServer";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET  /api/photos/categorize            → { configured }
 * POST /api/photos/categorize            { listingId, photoIds?, force?, cursor? }
 *      → { configured, updated: [{ id, category }], considered, unsure, remaining, next, error? }
 *      Pages: up to 48 photos / ~40 s of work per call; while `remaining` > 0
 *      call again with cursor = `next` (same photoIds / force).
 *
 * Labels photographs with a vision model so a broker's own uploads land in
 * the standard walk-through order without typing. The model uses a short
 * plain vocabulary ("Stateroom", "Head" — src/lib/aiPhotoLabels.ts). Only
 * touches photos still "Other"; `force` also re-labels the model's own
 * earlier labels. A category a person chose by hand, or a specific area from
 * the file name, is never overwritten.
 */

export async function GET() {
  return NextResponse.json({ configured: isAiConfigured() });
}

/** Work budget for one call, well inside maxDuration (60 s): no new model call starts after this… */
const WORK_BUDGET_MS = 40_000;
/** …and one still running at this point is stopped, so the answer is always JSON. */
const HARD_STOP_MS = 52_000;
/** At most this many photos per call; the page calls again with `next` (a 300-photo listing pages itself). */
const MAX_PHOTOS_PER_CALL = 48;

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    return await label(req, t0);
  } catch (err) {
    // Never let the platform answer with a non-JSON 500 — the page reads this.
    const message = err instanceof Error ? err.message : "Labelling failed";
    return NextResponse.json({ configured: true, updated: [], considered: 0, unsure: 0, remaining: 0, next: null, error: message }, { status: 500 });
  }
}

async function label(req: NextRequest, t0: number) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // Read-only demo (layer 3 — src/lib/demo.ts).
  { const demo = demoGuard(user, { allowWritableDemo: true }); if (demo) return demo; }

  if (!isAiConfigured()) return NextResponse.json({ configured: false, updated: [], considered: 0, unsure: 0, remaining: 0, next: null });

  let body: { listingId?: string; photoIds?: string[]; force?: boolean; cursor?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  if (!body.listingId) return NextResponse.json({ error: "Missing listingId" }, { status: 400 });
  const cursor = typeof body.cursor === "number" && Number.isFinite(body.cursor) ? Math.max(0, Math.floor(body.cursor)) : 0;

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const access = await assertListingAccess(service, body.listingId, user.id);
  if (access instanceof NextResponse) return access;
  { const own = demoRwOwnListing(user, access.brokerId); if (own) return own; }

  // Selection, cost guards, batching and concurrency live in
  // src/lib/labelPhotos.ts (shared with the relabel_photos background job).
  const r = await labelListingPhotos(service, body.listingId, {
    force: body.force,
    photoIds: body.photoIds,
    startPos: cursor,
    maxPhotos: MAX_PHOTOS_PER_CALL,
    deadlineMs: t0 + WORK_BUDGET_MS,
    hardStopMs: t0 + HARD_STOP_MS,
  });
  // `next` = where the following call starts (a position in the listing's
  // order, always past this call's photos), or null when nothing is left.
  const out = {
    configured: true, updated: r.updated, considered: r.considered, unsure: r.unsure,
    remaining: r.remaining, next: r.remaining > 0 ? r.nextPos : null,
  };
  if (r.error) return NextResponse.json({ ...out, error: r.error }, { status: 502 });
  return NextResponse.json(out);
}
