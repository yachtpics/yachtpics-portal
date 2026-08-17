import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";

export const runtime = "nodejs";

/**
 * POST /api/videos/details  { videoId, title?, description? }
 *
 * Sets what a video IS — "Aerial Drone Footage", "Sea Trial", "Owner Walkthrough"
 * — and an optional line describing it. Shown as the heading above the player on
 * the public boat page, and used in that video's schema so search engines have
 * something accurate to read.
 *
 * Open to whoever can already manage the listing (broker, their assistant, a
 * co-broker, admin), because the person who shot or commissioned the video is
 * the one who knows what it is.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const videoId = body?.videoId;
  if (!videoId) return NextResponse.json({ error: "Missing videoId" }, { status: 400 });

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: video } = await svc
    .from("videos")
    .select("id, listing_id")
    .eq("id", videoId)
    .maybeSingle();
  if (!video?.listing_id) return NextResponse.json({ error: "Video not found" }, { status: 404 });

  const access = await assertListingAccess(svc, video.listing_id, user.id, { includeCoBroker: true });
  if (access instanceof NextResponse) return access;

  // Trimmed, and empty means "no label" rather than an empty heading on the
  // page. Capped so a pasted paragraph can't wreck the layout.
  const clean = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim().slice(0, max);
    return t.length ? t : null;
  };

  const { error } = await svc
    .from("videos")
    .update({
      title: clean(body.title, 80),
      description: clean(body.description, 400),
    })
    .eq("id", videoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
