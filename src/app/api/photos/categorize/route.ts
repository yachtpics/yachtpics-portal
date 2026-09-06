import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { categorizePhotos, isAiConfigured } from "@/lib/ai";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET  /api/photos/categorize            → { configured }
 * POST /api/photos/categorize            { listingId, photoIds?, force? }
 *      → { configured, updated: [{ id, category }], considered, unsure }
 *
 * Labels photographs with a vision model so a broker's own uploads land in
 * the standard walk-through order without typing. Only touches photos whose
 * category was guessed (from the filename) or is still "Other" — a category a
 * person chose by hand is never overwritten unless `force` is set.
 */

const BATCH = 8;

export async function GET() {
  return NextResponse.json({ configured: isAiConfigured() });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

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

  let q = service.from("photos")
    .select("id, storage_path, category, category_source")
    .eq("listing_id", body.listingId)
    .order("display_order");
  if (Array.isArray(body.photoIds) && body.photoIds.length) q = q.in("id", body.photoIds.slice(0, 200));
  const { data: photos } = await q;

  // Custom categories the admin added are valid labels too.
  const { data: custom } = await service.from("custom_photo_categories").select("name");
  const categories = Array.from(new Set([...PHOTO_CATEGORIES.filter((c) => c !== "Other"), ...(custom ?? []).map((c) => c.name)]));

  // Default: only photos nobody (person or model) has labelled yet — still
  // "Other" or blank. `force` relabels everything except hand-set categories.
  const candidates = (photos ?? []).filter((p) => {
    if (p.category_source === "manual") return false;
    if (body.force) return true;
    if (p.category_source === "ai") return false;
    return !p.category || p.category === "Other";
  });

  const updated: { id: string; category: string }[] = [];
  let unsure = 0;

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const urls = await Promise.all(batch.map(async (p) => {
      const { data } = await service.storage.from("listing-photos").createSignedUrl(p.storage_path, 600, {
        transform: { width: 800, height: 800, resize: "contain", quality: 70 },
      });
      return data?.signedUrl ?? null;
    }));
    const usable = batch.map((p, j) => ({ p, url: urls[j] })).filter((x) => x.url) as { p: typeof batch[number]; url: string }[];
    if (!usable.length) continue;

    let labels: (string | null)[] = [];
    try {
      labels = await categorizePhotos(usable.map((u) => ({ url: u.url })), categories);
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI request failed";
      return NextResponse.json({ configured: true, updated, considered: candidates.length, unsure, error: message }, { status: 502 });
    }

    await Promise.all(usable.map(async ({ p }, j) => {
      const label = labels[j];
      if (!label) { unsure++; return; }
      if (label === p.category && p.category_source === "ai") return;
      const { error } = await service.from("photos").update({ category: label, category_source: "ai" }).eq("id", p.id);
      if (!error) updated.push({ id: p.id, category: label });
    }));
  }

  return NextResponse.json({ configured: true, updated, considered: candidates.length, unsure });
}
