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
 * POST /api/photos/categorize            { listingId, photoIds?, force? }
 *      → { configured, updated: [{ id, category }], considered, unsure }
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

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // Read-only demo (layer 3 — src/lib/demo.ts).
  { const demo = demoGuard(user, { allowWritableDemo: true }); if (demo) return demo; }

  if (!isAiConfigured()) return NextResponse.json({ configured: false, updated: [], considered: 0, unsure: 0 });

  let body: { listingId?: string; photoIds?: string[]; force?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  if (!body.listingId) return NextResponse.json({ error: "Missing listingId" }, { status: 400 });

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const access = await assertListingAccess(service, body.listingId, user.id);
  if (access instanceof NextResponse) return access;
  { const own = demoRwOwnListing(user, access.brokerId); if (own) return own; }

  // Selection, cost guards and batching live in src/lib/labelPhotos.ts (shared
  // with the relabel_photos background job).
  const r = await labelListingPhotos(service, body.listingId, { force: body.force, photoIds: body.photoIds });
  if (r.error) {
    return NextResponse.json({ configured: true, updated: r.updated, considered: r.considered, unsure: r.unsure, error: r.error }, { status: 502 });
  }
  return NextResponse.json({ configured: true, updated: r.updated, considered: r.considered, unsure: r.unsure });
}
