import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { draftDescription, isAiConfigured, type DescribableListing } from "@/lib/ai";
import { pickDescribePhotoUrls } from "@/lib/siteTextServer";
import { demoGuard } from "@/lib/demoServer";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/listings/[id]/describe → { configured, description }
 *
 * Drafts a listing description from the spec fields and a handful of the
 * listing's photographs. Nothing is saved — the draft lands in the edit form
 * for the broker to read, change, and save themselves.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // Read-only demo (layer 3 — src/lib/demo.ts).
  { const demo = demoGuard(user); if (demo) return demo; }
  if (!isAiConfigured()) return NextResponse.json({ configured: false, description: null });

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const access = await assertListingAccess(service, params.id, user.id);
  if (access instanceof NextResponse) return access;

  const { data: listing } = await service.from("listings")
    .select("vessel_name, vessel_type, year, make, model, length_ft, beam_ft, draft_ft, staterooms, heads, engines, engine_hours, fuel_type, cruising_speed_kn, max_speed_kn, hull_material, location, asking_price, description, hero_photo_id, photo_order_manual")
    .eq("id", params.id).single();
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

  // Cover, then one of each distinct area, up to six (shared with the
  // website-text draft — src/lib/siteTextServer.ts).
  const urls = await pickDescribePhotoUrls(service, params.id, listing);

  try {
    const description = await draftDescription(listing as DescribableListing, urls);
    return NextResponse.json({ configured: true, description });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "AI request failed" }, { status: 502 });
  }
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
