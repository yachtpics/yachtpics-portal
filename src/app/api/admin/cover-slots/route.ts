import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { releaseCoverSlot } from "@/lib/officeCoverSlots";

export const runtime = "nodejs";

/**
 * POST /api/admin/cover-slots { listingId } — a YachtPics admin releases the
 * slot a boat holds on a company admin's plan (Admin → Brokers → that admin →
 * "Release"). The boat goes back to locked for its owner until the company
 * admin uses a tool on it again (or on another boat). Nothing else changes —
 * no billing, no listing data.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({}));
  const listingId = typeof body?.listingId === "string" ? body.listingId : null;
  if (!listingId || !/^[0-9a-f-]{36}$/i.test(listingId)) return NextResponse.json({ error: "listingId required" }, { status: 400 });
  const released = await releaseCoverSlot(auth.admin, listingId, "released by YachtPics");
  if (!released) return NextResponse.json({ error: "That boat doesn't hold a slot any more." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
