import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { assertListingAccess } from "@/lib/assertListingAccess";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const listingId = params.id;
    if (!listingId) return NextResponse.json({ error: "Missing listing id" }, { status: 400 });

    const { photoCount } = await req.json();

    // Get the calling user from the session cookie
    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Use service role to bypass RLS for the insert
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Only log downloads for listings the caller can actually reach. The helper
    // covers broker, admin, linked assistant, co-broker and brokerage admin; a
    // colleague's shared listing (is_shared) is allowed if RLS lets the
    // caller's own session read it.
    const access = await assertListingAccess(supabase, listingId, user.id, {
      includeCoBroker: true,
      includeBrokerageAdmin: true,
    });
    if (access instanceof NextResponse) {
      if (access.status !== 403) return access;
      const { data: visible } = await serverSupabase
        .from("listings")
        .select("id")
        .eq("id", listingId)
        .maybeSingle();
      if (!visible) return access;
    }

    const { error } = await supabase.from("photo_downloads").insert({
      listing_id: listingId,
      downloaded_by: user.id,
      photo_count: photoCount ?? 1,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
