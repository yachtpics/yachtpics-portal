import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

// GET /api/admin/site/published-listings
//   → the boats currently live on yachtpics.com, in the order they'd re-publish.
// Powers the dashboard "Re-publish live boats" fallback (one request per boat
// from the tab) and "Boat page text" (which live boats still lack a
// description or a location). Admin only.
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const svc = auth.admin;

  const { data: listings, error } = await svc
    .from("listings")
    .select("id, vessel_name, site_page, description, location")
    .eq("publish_to_site", true)
    .eq("status", "active")
    .eq("showcase_opt_out", false)
    .order("site_page", { ascending: true })
    .order("vessel_name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    listings: (listings ?? []).map((l) => ({
      id: l.id as string,
      name: (l.vessel_name as string) ?? "Untitled",
      sitePage: (l.site_page as string | null) ?? null,
      hasDescription: !!((l.description as string | null) ?? "").trim(),
      hasLocation: !!((l.location as string | null) ?? "").trim(),
    })),
  });
}
