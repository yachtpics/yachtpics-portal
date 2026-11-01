import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { ypShareLive, ypShareUrl, type YpShareRow } from "@/lib/ypShare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The YachtPics share link for one listing (Nov 1, src/lib/ypShare.ts) —
 * ADMIN ONLY. Brokers never get this link from the portal.
 *
 * GET  → { available, enabled, published, live, url, siteUrl, socialUrl }
 *        `available: false` until migration 20261101b is applied.
 * POST { enabled: boolean } → switch it on/off for this listing.
 */
const COLS = "slideshow_published, slideshow_slug, yp_share_enabled, yp_share_token";

function shape(row: YpShareRow | null) {
  return {
    available: true,
    enabled: row?.yp_share_enabled === true,
    published: row?.slideshow_published === true,
    live: ypShareLive(row),
    url: ypShareUrl(row),
    siteUrl: ypShareUrl(row, "site"),
    socialUrl: ypShareUrl(row, "social"),
  };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { data, error } = await auth.admin.from("listings").select(COLS).eq("id", params.id).maybeSingle();
  if (error) return NextResponse.json({ available: false, live: false, url: null, siteUrl: null, socialUrl: null });
  if (!data) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  return NextResponse.json(shape(data as YpShareRow), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  let body: { enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  const { data, error } = await auth.admin
    .from("listings")
    .update({ yp_share_enabled: body.enabled })
    .eq("id", params.id)
    .select(COLS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Couldn't update the YachtPics link (has migration 20261101b been applied?)" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  return NextResponse.json(shape(data as YpShareRow));
}
