import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// POST /api/admin/listings/[id]/site-page  { sitePage: string | null }
//   → choose which yachtpics.com brokerage page this boat belongs on.
// Optional: most listings never go to the website, so null is a valid answer.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const raw = typeof body?.sitePage === "string" ? body.sitePage.trim() : "";
  const sitePage = raw === "" ? null : raw;

  // Only allow real pages — a typo here would publish a boat to a URL nothing links to.
  if (sitePage) {
    const { data: page } = await svc
      .from("site_pages")
      .select("filename")
      .eq("filename", sitePage)
      .maybeSingle();
    if (!page) return NextResponse.json({ error: "Unknown website page" }, { status: 400 });
  }

  const { error } = await svc.from("listings").update({ site_page: sitePage }).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, sitePage });
}
