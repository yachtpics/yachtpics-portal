import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";

export async function POST(req: NextRequest) {
  try {
    const { documentId, storagePath } = await req.json();
    if (!documentId || !storagePath) {
      return NextResponse.json({ error: "Missing documentId or storagePath" }, { status: 400 });
    }

    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Use service role for all permission checks — avoids RLS blocking the join read
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: doc } = await supabaseAdmin
      .from("documents")
      .select("id, listing_id")
      .eq("id", documentId)
      .single();

    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    // Verify caller is the broker or a linked assistant
    const access = await assertListingAccess(supabaseAdmin, doc.listing_id, user.id);
    if (access instanceof NextResponse) return access;

    await supabaseAdmin.storage.from("listing-documents").remove([storagePath]);
    const { error: dbError } = await supabaseAdmin
      .from("documents")
      .delete()
      .eq("id", documentId);

    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
