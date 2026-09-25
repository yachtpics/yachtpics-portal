import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runReelFollowUpSend } from "@/lib/sendReelFollowUp";
import {
  followUpWindowOpen, week1AutoSendToday, easternDate, WEEK1_AUTO_SEND_ON,
} from "@/lib/reelFollowUpEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Scheduled trigger for the WEEK-ONE reel follow-up only (last call stays a
// hand send). Called every day by /api/cron/daily. Sends ONLY when all hold:
//   1. the request carries the cron secret,
//   2. now is inside the week-one send window (followUpWindowOpen),
//   3. today's Eastern date is WEEK1_AUTO_SEND_ON (2026-09-25).
// It calls the exact function the admin "Send" button uses, so audience,
// unsubscribe filtering and the email_log dedup (FOLLOWUP_TYPE.week1) are the
// same: anyone already sent to — by hand or by an earlier run — is skipped.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    const querySecret = req.nextUrl.searchParams.get("secret");
    if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!followUpWindowOpen("week1")) {
    return NextResponse.json({ skipped: "outside send window" });
  }
  if (!week1AutoSendToday()) {
    return NextResponse.json({ skipped: `not the auto-send day (ET today ${easternDate()}, set for ${WEEK1_AUTO_SEND_ON})` });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const result = await runReelFollowUpSend(admin, "week1", "cron");
  if ("error" in result) return NextResponse.json({ skipped: result.error });
  return NextResponse.json({ ok: true, ...result });
}
