import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const { photoId, storagePath } = await req.json();
    if (!photoId || !storagePath) {
      return NextResponse.json({ error: "Missing photoId or storagePath" }, { status: 400 });
    }

    // Verify the requesting user is authenticated
    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Use service role for all permission checks — avoids RLS blocking reads
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: photo } = await supabaseAdmin
      .from("photos")
      .select("id, listing_id, listings(broker_id)")
      .eq("id", photoId)
      .single();

    if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

    const listing = photo.listings as unknown as { broker_id: string } | null;
    const brokerId = listing?.broker_id;

    const isOwner = brokerId === user.id;

    if (!isOwner) {
      // Check if they're a linked assistant for this broker
      const { data: profileData } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profileData?.role !== "assistant") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const { data: link } = await supabaseAdmin
        .from("broker_assistants")
        .select("broker_id")
        .eq("broker_id", brokerId)
        .eq("assistant_id", user.id)
        .maybeSingle();

      if (!link) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Delete from storage (best effort — file may already be missing)
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
