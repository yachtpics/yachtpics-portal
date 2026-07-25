import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// POST /api/g/[slug]/download  → record an anonymous public download from a gallery.
// No login required. We store a count only (user_id stays null), so Charlie can
// see how much a gallery is being downloaded without knowing who.
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: gallery } = await supabase
      .from("galleries")
      .select("id, slideshow_published, downloads_enabled, expires_at")
      .eq("slug", params.slug)
      .maybeSingle();

    // Only log for galleries that are actually published and downloadable — this
    // also stops the endpoint being used to write junk rows for view-only galleries.
    const open =
      gallery?.slideshow_published &&
      gallery.downloads_enabled === true &&
      (!gallery.expires_at || new Date(gallery.expires_at) > new Date());
    if (!gallery || !open) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let itemCount = 1;
    let kind = "single";
    try {
      const body = await req.json();
      if (typeof body?.itemCount === "number" && body.itemCount > 0) itemCount = Math.floor(body.itemCount);
      if (body?.kind === "zip" || body?.kind === "single") kind = body.kind;
    } catch {
      /* default single */
    }

    await supabase.from("gallery_downloads").insert({
      gallery_id: gallery.id,
      user_id: null,
      kind,
      item_count: itemCount,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
