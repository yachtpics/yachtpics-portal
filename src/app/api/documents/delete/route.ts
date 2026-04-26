import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const { documentId, storagePath } = await req.json();
    if (!documentId || !storagePath) {
      return NextResponse.json({ error: "Missing documentId or storagePath" }, { status: 400 });
    }

    // Verify the requesting user owns the listing this document belongs to
    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: doc } = await supabaseUser
      .from("documents")
      .select("id, listing_id, listings(broker_id)")
      .eq("id", documentId)
      .single();

    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const listing = doc.listings as unknown as { broker_id: string } | null;
    if (listing?.broker_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Use service role to delete (bypasses RLS)
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

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
