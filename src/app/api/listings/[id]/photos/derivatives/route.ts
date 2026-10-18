import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { ensureDerivatives, serviceRoleClient } from "@/lib/photoDerivatives";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IDS = 40;

/**
 * POST /api/listings/[id]/photos/derivatives  { photoIds: string[≤40] }
 *   → { done, skipped, unavailable, failed, deferred } (counts)
 *
 * Makes the 600px and 2000px WebP copies for freshly uploaded / replaced
 * photos (src/lib/photoDerivatives.ts). The upload helpers call it
 * fire-and-forget from the browser; if it never arrives, the daily backfill
 * (/api/cron/derivatives) picks the photos up and pages fall back to the old
 * transform links meanwhile.
 *
 * Access: signed in + the listing rule used by the sibling photo routes
 * (owner, linked assistant, co-broker, admin; brokerage admins too — this only
 * makes resized copies, nothing is removed or sent). Only photos that belong
 * to this listing are processed. Generation uses the service-role client.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const listingId = params.id;
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.photoIds)
    ? Array.from(new Set((body.photoIds as unknown[]).filter((x): x is string => typeof x === "string" && x.length <= 64))).slice(0, MAX_IDS)
    : [];
  if (!listingId || ids.length === 0) {
    return NextResponse.json({ error: "Missing listing or photo ids." }, { status: 400 });
  }

  const supabaseUser = await createServerClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = serviceRoleClient();
  const access = await assertListingAccess(svc, listingId, user.id, { includeCoBroker: true, includeBrokerageAdmin: true });
  if (access instanceof NextResponse) return access;

  const { data: rows } = await svc.from("photos").select("id").eq("listing_id", listingId).in("id", ids);
  const own = (rows ?? []).map((r) => r.id as string);
  if (own.length === 0) return NextResponse.json({ error: "Photo not found on this listing." }, { status: 404 });

  try {
    const r = await ensureDerivatives(own, { svc, concurrency: 4, deadline: Date.now() + 50_000 });
    return NextResponse.json({
      done: r.done.length,
      skipped: r.skipped.length,
      unavailable: r.unavailable.length,
      failed: r.failed.length,
      deferred: r.deferred.length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
