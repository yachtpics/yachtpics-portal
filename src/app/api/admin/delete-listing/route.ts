import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function DELETE(req: NextRequest) {
  try {
    const { listingId } = await req.json();
    if (!listingId) return NextResponse.json({ error: "Missing listingId" }, { status: 400 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get all photos to delete from storage
    const { data: photos } = await supabase
      .from("photos")
      .select("storage_path")
      .eq("listing_id", listingId);

    // Delete files from storage
    if (photos && photos.length > 0) {
      const paths = photos.map((p) => p.storage_path);
      await supabase.storage.from("listing-photos").remove(paths);
    }

    // Delete photo records
    await supabase.from("photos").delete().eq("listing_id", listingId);

    // Delete the listing
    const { error } = await supabase.from("listings").delete().eq("id", listingId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
