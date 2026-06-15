import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// POST /api/g/[slug]/view  → record a public slideshow view
export async function POST(_req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: gallery } = await supabase
      .from("galleries")
      .select("id, slideshow_published")
      .eq("slug", params.slug)
      .maybeSingle();
    if (!gallery || !gallery.slideshow_published) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await supabase.from("gallery_views").insert({ gallery_id: gallery.id });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
