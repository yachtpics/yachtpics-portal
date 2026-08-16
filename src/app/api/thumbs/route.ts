import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/thumbs  { listingId, width? }
 *   → { [photoId]: signedThumbnailUrl }
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
 * Supabase only supports transforms when signing a single URL at a time, so the
 * signing is still per-photo — but it happens here, in parallel, once.
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
  const access = await assertListingAccess(service, body.listingId, user.id, { includeCoBroker: true });
  if (access instanceof NextResponse) return access;

  const { data: photos } = await service
    .from("photos")
    .select("id, storage_path")
    .eq("listing_id", body.listingId);
  if (!photos?.length) return NextResponse.json({ urls: {} });

  const urls: Record<string, string> = {};
  for (let i = 0; i < photos.length; i += CHUNK) {
    const batch = photos.slice(i, i + CHUNK);
    await Promise.all(
      batch.map(async (p) => {
        const { data } = await service.storage
          .from("listing-photos")
          .createSignedUrl(p.storage_path, 60 * 60 * 6, {
            transform: { width, height: width, resize: "contain", quality: 72 },
          });
        if (data?.signedUrl) urls[p.id] = data.signedUrl;
      })
    );
  }

  return NextResponse.json({ urls });
}
