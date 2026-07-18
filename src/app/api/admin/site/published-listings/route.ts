import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// GET /api/admin/site/published-listings
//   → the boats currently live on yachtpics.com, in the order they'd re-publish.
// Powers the dashboard "Re-publish live boats" action, which re-runs each one
// through the normal publish pipeline (e.g. to refresh photo order after a
// change to the ordering rules). Admin only.
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { data: listings } = await svc
    .from("listings")
    .select("id, vessel_name, site_page")
    .eq("publish_to_site", true)
    .eq("status", "active")
    .eq("showcase_opt_out", false)
    .order("site_page", { ascending: true })
    .order("vessel_name", { ascending: true });

  return NextResponse.json({
    listings: (listings ?? []).map((l) => ({
      id: l.id as string,
      name: (l.vessel_name as string) ?? "Untitled",
    })),
  });
}
