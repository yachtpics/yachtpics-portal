import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";

export async function POST(req: NextRequest) {
  try {
    // storagePath is still accepted for compatibility with callers that send
    // it, but is deliberately ignored — the row is the authority on where the
    // file actually lives.
    const { videoId } = await req.json();
    if (!videoId) {
      return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
    }

    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Use service role for all permission checks — avoids RLS blocking the join read
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: video } = await supabaseAdmin
      .from("videos")
      .select("id, listing_id, storage_path, thumbnail_path")
      .eq("id", videoId)
      .single();

    if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });

    // Verify caller is the broker or a linked assistant
    const access = await assertListingAccess(supabaseAdmin, video.listing_id, user.id);
    if (access instanceof NextResponse) return access;

    // Delete the path recorded against the row, NOT the one the caller sent.
    // Access is checked per listing, but the path arrived in the request body
    // and this runs with the service role — so a caller entitled to delete one
    // video could have named any file in the bucket and had it removed.
    await supabaseAdmin.storage.from("listing-videos").remove([video.storage_path]);

    // The still captured from this video lives in the photos bucket. Remove it
    // too — it's useless without the video, and orphaned files would quietly
    // accumulate against the storage bill.
    if (video.thumbnail_path) {
      await supabaseAdmin.storage.from("listing-photos").remove([video.thumbnail_path]);
    }

    const { error: dbError } = await supabaseAdmin
      .from("videos")
      .delete()
      .eq("id", videoId);

    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
