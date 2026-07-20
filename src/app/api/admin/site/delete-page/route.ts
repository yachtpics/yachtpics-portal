import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { renderBoatsIndex } from "@/lib/sitePublish";
import { ftpConfigured, deleteFiles, uploadFiles } from "@/lib/siteFtp";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/site/delete-page  { filename: string }
//   → permanently remove a RETIRED brokerage page from the website: delete its
//     .html off the server and refresh the Boats index so it's gone from the
//     list too. Admin only.
//
// Guardrail: only pages already deactivated (is_active = false) can be deleted,
// so a live brokerage can't be wiped by a stray click. Deactivate first, then
// delete.
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
  const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
  if (!filename) return NextResponse.json({ error: "filename is required" }, { status: 400 });

  const { data: page } = await svc
    .from("site_pages")
    .select("filename, label, is_active")
    .eq("filename", filename)
    .maybeSingle();
  if (!page) return NextResponse.json({ error: "No such page." }, { status: 404 });
  if (page.is_active) {
    return NextResponse.json(
      { error: `"${page.label}" is still active — deactivate it before deleting.` },
      { status: 400 }
    );
  }

  if (!ftpConfigured()) {
    return NextResponse.json({ error: "FTP is not configured — can't delete from the server." }, { status: 400 });
  }

  // Remove the brokerage page file itself.
  const del = await deleteFiles([`${filename}.html`]);
  if (del.error) return NextResponse.json({ error: del.error }, { status: 502 });

  // Drop its captured archive links so nothing lingers in the DB.
  await svc.from("brokerage_site_archive").delete().eq("site_page", filename);

  // Refresh the Boats index so the page is gone from the list too (it's already
  // excluded, being inactive — this just pushes the current state live).
  const index = await renderBoatsIndex();
  if (index) {
    const up = await uploadFiles([index]);
    if (up.error) {
      return NextResponse.json(
        { success: true, deleted: del.deleted, warning: `Page deleted, but the Boats index didn't refresh: ${up.error}` },
        { status: 200 }
      );
    }
  }

  return NextResponse.json({ success: true, deleted: del.deleted });
}
