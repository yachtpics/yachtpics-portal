import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// POST /api/d/[token]/log  → record a download from a public link (no auth)
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const { photoCount } = await req.json().catch(() => ({ photoCount: 1 }));

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: link } = await supabase
      .from("download_links")
      .select("id, listing_id, revoked, expires_at")
      .eq("token", params.token)
      .single();

    if (!link) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    if (link.revoked) return NextResponse.json({ error: "Link revoked" }, { status: 410 });
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "Link expired" }, { status: 410 });
    }

    await supabase.from("download_link_downloads").insert({
      download_link_id: link.id,
      listing_id: link.listing_id,
      photo_count: typeof photoCount === "number" && photoCount > 0 ? photoCount : 1,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
