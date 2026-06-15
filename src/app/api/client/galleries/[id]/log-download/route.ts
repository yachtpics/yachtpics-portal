import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// POST /api/client/galleries/[id]/log-download  → record a download by the logged-in client
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Must have access to this gallery
  const { data: access } = await service
    .from("gallery_access")
    .select("id")
    .eq("gallery_id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!access) return NextResponse.json({ error: "No access" }, { status: 403 });

  // Must not be expired
  const { data: gallery } = await service
    .from("galleries")
    .select("expires_at")
    .eq("id", params.id)
    .single();
  if (gallery?.expires_at && new Date(gallery.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Downloads have closed for this gallery." }, { status: 410 });
  }

  const { kind, count } = await req.json().catch(() => ({ kind: "photo", count: 1 }));

  await service.from("gallery_downloads").insert({
    gallery_id: params.id,
    user_id: user.id,
    kind: ["photo", "video", "zip"].includes(kind) ? kind : "photo",
    item_count: typeof count === "number" && count > 0 ? count : 1,
  });

  return NextResponse.json({ success: true });
}
