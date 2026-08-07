import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

const SITE_URL = "https://portal.yachtpics.com";

function linkUrl(token: string) {
  return `${SITE_URL}/d/${token}`;
}

// GET /api/admin/download-links?listingId=...  → list links for a listing
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  const listingId = req.nextUrl.searchParams.get("listingId");
  if (!listingId) return NextResponse.json({ error: "Missing listingId" }, { status: 400 });

  const { data: links, error } = await admin
    .from("download_links")
    .select("id, token, label, expires_at, revoked, created_at, scope")
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Download counts per link
  const ids = (links ?? []).map((l) => l.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: dl } = await admin
      .from("download_link_downloads")
      .select("download_link_id")
      .in("download_link_id", ids);
    for (const row of dl ?? []) {
      counts.set(row.download_link_id, (counts.get(row.download_link_id) ?? 0) + 1);
    }
  }

  const now = Date.now();
  const result = (links ?? []).map((l) => ({
    ...l,
    url: linkUrl(l.token),
    download_count: counts.get(l.id) ?? 0,
    status: l.revoked
      ? "revoked"
      : l.expires_at && new Date(l.expires_at).getTime() < now
      ? "expired"
      : "active",
  }));

  return NextResponse.json({ links: result });
}

// POST /api/admin/download-links  → create a new link
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin, userId } = auth;

  let body: { listingId?: string; label?: string; expiryDays?: number | null; scope?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { listingId, label, expiryDays } = body;
  if (!listingId) return NextResponse.json({ error: "Missing listingId" }, { status: 400 });

  // What the link hands over: photos only, videos only, or both. Lets a broker
  // be sent a video without a 200-photo download attached, and vice versa.
  const scope = body.scope === "photos" || body.scope === "videos" ? body.scope : "both";

  // Confirm listing exists
  const { data: listing } = await admin
    .from("listings")
    .select("id")
    .eq("id", listingId)
    .single();
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

  const token = randomBytes(24).toString("base64url");
  const expires_at =
    expiryDays && expiryDays > 0
      ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const { data: created, error } = await admin
    .from("download_links")
    .insert({
      token,
      listing_id: listingId,
      created_by: userId,
      label: label?.trim() || null,
      expires_at,
      scope,
    })
    .select("id, token, label, expires_at, revoked, created_at, scope")
    .single();

  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? "Failed to create link" }, { status: 500 });
  }

  return NextResponse.json({
    link: {
      ...created,
      url: linkUrl(created.token),
      download_count: 0,
      status: "active",
    },
  });
}
