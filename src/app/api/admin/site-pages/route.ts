import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// POST /api/admin/site-pages  { label: string }
//   → add a brand-new brokerage page to the taxonomy, so it appears in the
//     listing picker and (once a boat publishes) in the Boats index.
//
// Only for brokerages that have NEVER been on the website. It's stamped
// archive_checked_at immediately: a new brokerage has no existing galleries to
// capture, so there's nothing the publish guard needs to protect. Do NOT use
// this to re-add one of the 79 existing pages — that would fork the URL.
export async function POST(req: NextRequest) {
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
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  // Canonical filename for a NEW page — clean slug. (Existing pages keep their
  // historical quirks; those are already seeded and must never be re-derived.)
  const filename = label
    .toLowerCase()
    .replace(/['"’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!filename) return NextResponse.json({ error: "Couldn't derive a page name" }, { status: 400 });

  const { data: existing } = await svc
    .from("site_pages")
    .select("label, filename")
    .eq("filename", filename)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: `A page already exists for "${existing.label}" (${filename}.html). Pick it from the list instead.` },
      { status: 409 }
    );
  }

  const { data: max } = await svc
    .from("site_pages")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (max?.sort_order ?? 0) + 1;

  const { error } = await svc.from("site_pages").insert({
    label,
    filename,
    sort_order: nextOrder,
    is_active: true,
    // Brand-new brokerage: no prior galleries, so it's safe to publish to.
    archive_checked_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, label, filename });
}
