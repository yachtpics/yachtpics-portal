import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { ensureDerivatives, signDerivatives } from "@/lib/photoDerivatives";
import { runInBackground } from "@/lib/jobs/queue";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/thumbs  { listingId, width? }
 *   → { urls: { [photoId]: signedThumbnailUrl }, missing: photoId[] }
 *
 * `missing` lists photos whose file isn't in storage (signing fails for those).
 * The broker listing page uses it for the "File missing" tile — it used to
 * learn that by signing every full-size original up front.
 *
 * One access check, one response, and then every thumbnail loads straight from
 * Supabase's CDN.
 *
 * The first attempt at this proxied each thumbnail through a per-image route,
 * which meant a round trip to us plus a few access queries BEFORE the image
 * request even started — repeated for every photo on the page. On a 227-photo
 * listing that overhead swamped the saving from resizing. Checking access once
 * and handing back all the URLs removes the proxy from the hot path entirely.
 *
 * Oct 18 — stored derivatives: photos with `derivatives_at` set get their
 * pre-made 600px WebP copy, ALL signed in ONE createSignedUrls call (plain
 * objects — no transform rate limit, no per-photo round trip). Only photos
 * without derivatives yet fall back to the per-photo transform signing below
 * (Supabase only supports transforms one URL at a time). `width` is ignored
 * for derivative photos — 600 serves the 200/400 tiles and the 800 is close.
 */

const ALLOWED_WIDTHS = [200, 400, 800];
// Signing is a network call per photo, and the chunks run one after another —
// so a small chunk on a 227-photo listing meant ~10 sequential round trips.
// Wider batches cut that to two or three.
const CHUNK = 100;

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { listingId?: string; width?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.listingId) return NextResponse.json({ error: "Missing listingId" }, { status: 400 });

  const width = ALLOWED_WIDTHS.includes(Number(body.width)) ? Number(body.width) : 400;

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Access is verified once, for the listing — not once per photo.
  const access = await assertListingAccess(service, body.listingId, user.id, { includeCoBroker: true, includeBrokerageAdmin: true });
  if (access instanceof NextResponse) return access;

  const { data: photos } = await service
    .from("photos")
    .select("id, storage_path, derivatives_at, storage_backend")
    .eq("listing_id", body.listingId);
  if (!photos?.length) return NextResponse.json({ urls: {}, missing: [] });

  const TTL = 60 * 60 * 6;
  const derived = await signDerivatives(service, photos, 600, TTL);
  const urls: Record<string, string> = { ...derived.urls };
  const missing: string[] = [];
  const fallback = derived.missing;
  // Originals on R2 (Oct 28) can't be resized by Supabase and are never sent
  // as tiles: until their stored copies exist (made right after upload) they
  // are listed as `processing` (no url — the tile shows a placeholder), and
  // making the copies is kicked off in the background.
  const r2Fallback = fallback.filter((p) => (p as { storage_backend?: string | null }).storage_backend === "r2");
  const processing = r2Fallback.filter((p) => !p.derivatives_at).map((p) => p.id);
  if (processing.length) {
    runInBackground(ensureDerivatives(processing.slice(0, 40), { svc: service, concurrency: 4, deadline: Date.now() + 50_000 }));
  }
  const supaFallback = fallback.filter((p) => (p as { storage_backend?: string | null }).storage_backend !== "r2");
  for (let i = 0; i < supaFallback.length; i += CHUNK) {
    const batch = supaFallback.slice(i, i + CHUNK);
    await Promise.all(
      batch.map(async (p) => {
        const { data, error } = await service.storage
          .from("listing-photos")
          .createSignedUrl(p.storage_path, TTL, {
            transform: { width, height: width, resize: "contain", quality: 72 },
          });
        if (data?.signedUrl) urls[p.id] = data.signedUrl;
        else if (error && /not.?found|does not exist/i.test(error.message)) missing.push(p.id);
      })
    );
  }

  // Image transformation is a project-level setting, and if it's ever switched
  // off Supabase quietly signs the original instead of erroring — so the page
  // still "works" while downloading full-size files. One line in the logs is
  // the difference between noticing that and not.
  const list = supaFallback.map((p) => urls[p.id]).filter(Boolean);
  if (list.length > 0 && list.some((u) => !u.includes("/render/image/"))) {
    console.warn(
      "Supabase image transformation appears to be disabled — /api/thumbs is returning full-size originals"
    );
  }

  return NextResponse.json({ urls, missing, ...(processing.length ? { processing } : {}) });
}
