import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { isAiConfigured } from "@/lib/ai";
import { draftSiteTextForListing } from "@/lib/siteTextServer";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/listings/[id]/site-describe → { configured, draft }
 *
 * Drafts the yachtpics.com boat-page text (listings.site_description) from
 * the listing's facts and up to six of its photographs (same pick as the
 * broker "Draft with AI"). Nothing is saved — the draft goes into the Website
 * page card's text box for the owner to edit and save. Admin only. The
 * broker's own description is never read.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  if (!isAiConfigured()) return NextResponse.json({ configured: false, draft: null });

  try {
    const draft = await draftSiteTextForListing(auth.admin, params.id);
    return NextResponse.json({ configured: true, draft });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI request failed";
    return NextResponse.json({ error: msg }, { status: msg === "Listing not found" ? 404 : 502 });
  }
}
