import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { republishLiveListing } from "@/lib/sitePublish";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/listings/[id]/site-text — the yachtpics.com page text.
 * Admin only. These columns are YachtPics' own (separate from the broker's
 * listings.description) and no broker route writes them.
 *
 * Body: { action, siteDescription?, location?, publish? }
 *
 *   action "save" (default)
 *       siteDescription → listings.site_description (trimmed; "" = none) and
 *                         clears any waiting draft.
 *       location        → listings.location (trimmed; "" = none) and clears
 *                         any waiting location suggestion.
 *       Only the fields sent are changed.
 *   action "approve"    site_description = siteDescription (an edited draft)
 *                       or else the waiting draft; draft cleared.
 *   action "discard"    clear the waiting draft.
 *   action "acceptLocation"   location = location (edited) or the suggestion;
 *                             suggestion cleared.
 *   action "dismissLocation"  clear the suggestion.
 *
 * publish: true (any action) then re-publishes the boat if it is live on
 * yachtpics.com, through the same build + upload as publish-site. A boat that
 * isn't live is never put on the site from here.
 *
 * → { success, listing: { siteDescription, siteDescriptionDraft, location,
 *     siteLocationSuggestion }, published?, publishError?, previewOnly? }
 */
const MAX_TEXT = 2000;
const MAX_LOCATION = 120;

type Row = {
  site_description: string | null;
  site_description_draft: string | null;
  location: string | null;
  site_location_suggestion: string | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const svc = auth.admin;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "save";

  const { data: cur, error: readErr } = await svc
    .from("listings")
    .select("site_description, site_description_draft, location, site_location_suggestion")
    .eq("id", params.id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!cur) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  const row = cur as Row;

  const text = str(body.siteDescription);
  const loc = str(body.location);
  if (text !== null && text.length > MAX_TEXT) {
    return NextResponse.json({ error: `The website text is too long (${text.length} characters; the limit is ${MAX_TEXT}).` }, { status: 400 });
  }
  if (loc !== null && loc.length > MAX_LOCATION) {
    return NextResponse.json({ error: `The location is too long (the limit is ${MAX_LOCATION} characters).` }, { status: 400 });
  }

  const updates: Partial<Row> & { site_description_drafted_at?: null } = {};
  if (action === "save") {
    if ("siteDescription" in body) {
      updates.site_description = text || null;
      updates.site_description_draft = null;
      updates.site_description_drafted_at = null;
    }
    if ("location" in body) {
      updates.location = loc || null;
      updates.site_location_suggestion = null;
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  } else if (action === "approve") {
    const approved = text || (row.site_description_draft ?? "").trim();
    if (!approved) return NextResponse.json({ error: "There's no draft waiting for this boat." }, { status: 400 });
    updates.site_description = approved;
    updates.site_description_draft = null;
    updates.site_description_drafted_at = null;
  } else if (action === "discard") {
    updates.site_description_draft = null;
    updates.site_description_drafted_at = null;
  } else if (action === "acceptLocation") {
    const accepted = loc || (row.site_location_suggestion ?? "").trim();
    if (!accepted) return NextResponse.json({ error: "There's no location suggestion waiting for this boat." }, { status: 400 });
    updates.location = accepted;
    updates.site_location_suggestion = null;
  } else if (action === "dismissLocation") {
    updates.site_location_suggestion = null;
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const { data: saved, error: upErr } = await svc
    .from("listings")
    .update(updates)
    .eq("id", params.id)
    .select("site_description, site_description_draft, location, site_location_suggestion")
    .maybeSingle();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  const s = (saved ?? { ...row, ...updates }) as Row;

  const out: Record<string, unknown> = {
    success: true,
    listing: {
      siteDescription: s.site_description,
      siteDescriptionDraft: s.site_description_draft,
      location: s.location,
      siteLocationSuggestion: s.site_location_suggestion,
    },
  };

  if (body.publish === true) {
    try {
      const r = await republishLiveListing(params.id);
      if (r.ok) out.published = true;
      else if ("previewOnly" in r) { out.published = false; out.previewOnly = r.previewOnly; }
      else { out.published = false; out.publishError = r.error; }
    } catch (e) {
      out.published = false;
      out.publishError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json(out);
}
