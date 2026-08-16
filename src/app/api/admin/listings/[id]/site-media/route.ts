import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { isSiteMedia } from "@/lib/siteMedia";

export const runtime = "nodejs";

/**
 * POST /api/admin/listings/[id]/site-media  { siteMedia: "photos" | "video" | "both" }
 *
 * Records what this boat should show on yachtpics.com. Admin only, matching the
 * publish-site route beside it — what appears on the public website is our call,
 * not the broker's.
 *
 * Saving does NOT re-publish. The live page is only rewritten on the next
 * publish, which the admin page says on screen; making this route publish as a
 * side effect would mean an idle click silently pushing a half-finished boat to
 * the public site.
 */
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
  const siteMedia = body?.siteMedia;
  if (!isSiteMedia(siteMedia)) {
    return NextResponse.json({ error: "siteMedia must be photos, video, or both" }, { status: 400 });
  }

  // Choosing video for a boat with no video would produce an empty page, so
  // refuse rather than publish something broken.
  if (siteMedia !== "photos") {
    const { count } = await svc
      .from("videos")
      .select("id", { count: "exact", head: true })
      .eq("listing_id", params.id);
    if (!count) {
      return NextResponse.json({ error: "This boat has no video uploaded." }, { status: 400 });
    }
  }

  const { error } = await svc
    .from("listings")
    .update({ site_media: siteMedia })
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, siteMedia });
}
