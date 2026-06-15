import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// PATCH /api/client/galleries/[id]/photos
// A logged-in recipient curates the slideshow: toggle a photo's visibility or reorder.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: access } = await service
    .from("gallery_access")
    .select("id")
    .eq("gallery_id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!access) return NextResponse.json({ error: "No access" }, { status: 403 });

  let body: { action?: string; photoId?: string; isVisible?: boolean; orderedIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.action === "visibility" && body.photoId) {
    const { error } = await service
      .from("photos")
      .update({ is_visible: !!body.isVisible })
      .eq("id", body.photoId)
      .eq("gallery_id", params.id); // scoped to this gallery only
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (body.action === "reorder" && Array.isArray(body.orderedIds)) {
    await Promise.all(
      body.orderedIds.map((id, i) =>
        service.from("photos").update({ display_order: i }).eq("id", id).eq("gallery_id", params.id)
      )
    );
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
