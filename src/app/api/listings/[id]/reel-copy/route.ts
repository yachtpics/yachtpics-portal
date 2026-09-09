import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { draftReelCopy, isAiConfigured, type DescribableListing } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/listings/[id]/reel-copy  { photoIds: string[] }
 *   → { configured, headline, caption, hashtags }
 *
 * Writes the words for a reel from the photographs the broker actually chose,
 * in the order they'll appear. Nothing is saved: the headline lands in a field
 * they can edit and the caption in a box they can copy — the broker is still
 * the one who decides what goes out under their name.
 *
 * The photo ids come from the client because the selection lives there and is
 * the whole point; they're re-read from the database against this listing, so a
 * caller can't reach photographs on a boat they don't have access to.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isAiConfigured()) return NextResponse.json({ configured: false });

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const access = await assertListingAccess(service, params.id, user.id, { includeCoBroker: true });
  if (access instanceof NextResponse) return access;

  const body = await req.json().catch(() => ({}));
  // Ten is what the writer reads; signing more would be paid-for and ignored.
  const ids: string[] = Array.isArray(body?.photoIds)
    ? body.photoIds.filter((x: unknown) => typeof x === "string").slice(0, 10)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: "Choose some photos first." }, { status: 400 });

  const { data: listing } = await service.from("listings")
    .select("vessel_name, vessel_type, year, make, model, length_ft, beam_ft, draft_ft, staterooms, heads, engines, engine_hours, fuel_type, cruising_speed_kn, max_speed_kn, hull_material, location, asking_price, description")
    .eq("id", params.id).single();
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

  // Scoped to this listing — the ids are a selection, not an authorisation.
  const { data: rows } = await service.from("photos")
    .select("id, storage_path, category")
    .eq("listing_id", params.id)
    .in("id", ids);
  if (!rows || rows.length === 0) return NextResponse.json({ error: "Those photos aren't on this listing." }, { status: 400 });

  // Back into the broker's chosen order — the model should read the reel the
  // way a buyer will watch it.
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const ordered = ids.map((i) => byId.get(i)).filter((r): r is NonNullable<typeof r> => !!r);

  const photos = (await Promise.all(ordered.map(async (p) => {
    const { data } = await service.storage.from("listing-photos").createSignedUrl(p.storage_path as string, 600, {
      transform: { width: 800, height: 800, resize: "contain", quality: 70 },
    });
    return data?.signedUrl ? { url: data.signedUrl, category: (p.category as string | null) ?? null } : null;
  }))).filter(Boolean) as { url: string; category: string | null }[];

  if (photos.length === 0) return NextResponse.json({ error: "Couldn't read those photos." }, { status: 502 });

  try {
    const copy = await draftReelCopy(listing as DescribableListing, photos);
    return NextResponse.json({ configured: true, ...copy });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "AI request failed" }, { status: 502 });
  }
}
