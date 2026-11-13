import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { demoGuard } from "@/lib/demoServer";
import { logoFileError, storeBrokerLogoFile } from "@/lib/brokerLogoUpload";

// File type / size rules and the storage path live in src/lib/brokerLogoUpload.ts,
// shared with the admin's upload (POST /api/admin/brokers/[id]/logo).
export async function POST(req: NextRequest) {
  try {
    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Read-only demo (layer 3 — src/lib/demo.ts).
    { const demo = demoGuard(user); if (demo) return demo; }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const invalid = logoFileError(file);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const stored = await storeBrokerLogoFile(supabaseAdmin, user.id, file);
    if (stored.error !== undefined) {
      return NextResponse.json({ error: stored.error }, { status: 500 });
    }
    const publicUrl = stored.url;

    const { error: dbError } = await supabaseAdmin
      .from("broker_details")
      // Upsert: a broker who uploads a logo before ever saving their profile
      // has no broker_details row yet, and a plain update saved nothing.
      .upsert({ id: user.id, logo_url: publicUrl }, { onConflict: "id" });

    if (dbError) {
      return NextResponse.json({ error: `DB update failed: ${dbError.message}` }, { status: 500 });
    }

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
