import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

// GET /api/admin/site/published-listings
//   → the boats currently live on yachtpics.com, in the order they'd re-publish.
// Powers the dashboard "Re-publish live boats" fallback (one request per boat
// from the tab) and "Boat page text": which live boats still lack website
// text (listings.site_description — YachtPics' own, NOT the broker's
// description) or a location, plus any AI draft / location suggestion
// waiting for review. Admin only.
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const svc = auth.admin;

  const { data: listings, error } = await svc
    .from("listings")
    .select("id, vessel_name, site_page, site_slug, location, site_description, site_description_draft, site_description_drafted_at, site_location_suggestion")
    .eq("publish_to_site", true)
    .eq("status", "active")
    .eq("showcase_opt_out", false)
    .order("site_page", { ascending: true })
    .order("vessel_name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const t = (v: unknown) => ((v as string | null) ?? "").trim();
  return NextResponse.json({
    listings: (listings ?? []).map((l) => {
      const sitePage = (l.site_page as string | null) ?? null;
      const slug = (l.site_slug as string | null) ?? null;
      return {
        id: l.id as string,
        name: (l.vessel_name as string) ?? "Untitled",
        sitePage,
        pageUrl: sitePage && slug ? `https://www.yachtpics.com/${sitePage}/${slug}/index.html` : null,
        hasDescription: !!t(l.site_description),
        hasLocation: !!t(l.location),
        location: t(l.location) || null,
        draft: t(l.site_description_draft) || null,
        draftedAt: (l.site_description_drafted_at as string | null) ?? null,
        locationSuggestion: t(l.site_location_suggestion) || null,
      };
    }),
  });
}
