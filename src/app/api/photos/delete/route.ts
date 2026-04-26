import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const { photoId, storagePath } = await req.json();
    if (!photoId || !storagePath) {
      return NextResponse.json({ error: "Missing photoId or storagePath" }, { status: 400 });
    }

    // Verify the requesting user owns the listing this photo belongs to
    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: photo } = await supabaseUser
      .from("photos")
      .select("id, listing_id, listings(broker_id)")
      .eq("id", photoId)
      .single();

    if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

    const listing = photo.listings as unknown as { broker_id: string } | null;
    if (listing?.broker_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Use service role to do the actual delete (bypasses RLS)
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await supabaseAdmin.storage.from("listing-photos").remove([storagePath]);
    const { error: dbError } = await supabaseAdmin
      .from("photos")
      .delete()
      .eq("id", photoId);

    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
