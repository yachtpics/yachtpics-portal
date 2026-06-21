import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runAnnouncementSend } from "@/lib/sendAnnouncement";
import { ANNOUNCEMENT_TYPE, ANNOUNCEMENT_SEND_AFTER, ANNOUNCEMENT_SEND_BEFORE } from "@/lib/announcementEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPROVE_KEY = `${ANNOUNCEMENT_TYPE}_approved`;

// Scheduled trigger for the product announcement. Sends ONLY when all hold true:
//   1. the request carries the cron secret,
//   2. now is inside the campaign window (the intended Monday),
//   3. an admin has approved the campaign.
// Already-sent recipients are skipped by runAnnouncementSend's dedup.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    const querySecret = req.nextUrl.searchParams.get("secret");
    if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = Date.now();
  if (now < Date.parse(ANNOUNCEMENT_SEND_AFTER) || now > Date.parse(ANNOUNCEMENT_SEND_BEFORE)) {
    return NextResponse.json({ skipped: "outside send window" });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: setting } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", APPROVE_KEY)
    .maybeSingle();
  if (setting?.value !== true) {
    return NextResponse.json({ skipped: "not approved" });
  }

  const result = await runAnnouncementSend(admin, "cron");
  return NextResponse.json({ ok: true, ...result });
}
