import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runAnnouncementSend } from "@/lib/sendAnnouncement";
import { ANNOUNCEMENT_CAMPAIGNS, announcementApproveKey } from "@/lib/announcementEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The subscriber campaign looks up ~150 brokers' access before sending.
export const maxDuration = 60;

// Scheduled trigger for the announcement campaigns (ANNOUNCEMENT_CAMPAIGNS:
// the subscriber early-access email and the general launch). Each campaign is
// checked on its own and sends ONLY when all hold true:
//   1. the request carries the cron secret,
//   2. now is inside THAT campaign's window (sendAfter/sendBefore),
//   3. an admin has approved THAT campaign (app_settings `${type}_approved`).
// Already-sent recipients are skipped by runAnnouncementSend's dedup; the
// general launch also skips anyone who got the early-access email.
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

  const campaigns: Record<string, unknown> = {};
  // Sequential, early first: their windows don't overlap, but if they ever do,
  // the general send must see the early send's email_log rows.
  for (let i = 0; i < ANNOUNCEMENT_CAMPAIGNS.length; i++) {
    const c = ANNOUNCEMENT_CAMPAIGNS[i];
    try {
      const now = Date.now();
      if (now < Date.parse(c.sendAfter) || now > Date.parse(c.sendBefore)) {
        campaigns[c.type] = { skipped: "outside send window" };
        continue;
      }
      const { data: setting } = await admin
        .from("app_settings")
        .select("value")
        .eq("key", announcementApproveKey(c))
        .maybeSingle();
      if (setting?.value !== true) {
        campaigns[c.type] = { skipped: "not approved" };
        continue;
      }
      const result = await runAnnouncementSend(admin, "cron", c);
      campaigns[c.type] = { ok: true, ...result };
    } catch (e) {
      campaigns[c.type] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({ ok: true, campaigns });
}
