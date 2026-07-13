import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// POST /api/client/galleries/[id]/log-open
//   → record that a recipient opened their private gallery.
// Throttled to one open per user per gallery every 30 minutes so a refresh or
// quick revisit doesn't inflate the count.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
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

  // Throttle: skip if this user opened this gallery in the last 30 minutes
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: recent } = await service
    .from("gallery_opens")
    .select("id")
    .eq("gallery_id", params.id)
    .eq("user_id", user.id)
    .gte("opened_at", cutoff)
    .maybeSingle();

  if (!recent) {
    await service.from("gallery_opens").insert({ gallery_id: params.id, user_id: user.id });
  }

  return NextResponse.json({ success: true });
}
