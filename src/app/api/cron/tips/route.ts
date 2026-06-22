import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runTipsDrip } from "@/lib/sendTips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Weekly tips drip. Sends each eligible recipient their next approved tip.
// Approval + pacing + dedup are all enforced inside runTipsDrip, so this just
// authenticates and runs.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    const querySecret = req.nextUrl.searchParams.get("secret");
    if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const result = await runTipsDrip(admin, "cron");
  return NextResponse.json({ ok: true, ...result });
}
