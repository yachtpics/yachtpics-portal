import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runReelFollowUpSend } from "@/lib/sendReelFollowUp";
import {
  followUpWindowOpen, week1AutoSendToday, lastCallAutoSendToday, easternDate,
  WEEK1_AUTO_SEND_ON, LASTCALL_AUTO_SEND_ON,
} from "@/lib/reelFollowUpEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Scheduled trigger for the two reel follow-ups. Called every day by
// /api/cron/daily. Each follow-up is checked on its own and sends ONLY when
// all hold:
//   1. the request carries the cron secret,
//   2. now is inside that follow-up's send window (followUpWindowOpen),
//   3. today's Eastern date is its auto-send day —
//        week one:  WEEK1_AUTO_SEND_ON    (2026-09-25)
//        last call: LASTCALL_AUTO_SEND_ON (2026-09-30)
// It calls the exact function the admin "Send" button uses, so audience,
// unsubscribe filtering and the email_log dedup (FOLLOWUP_TYPE[key]) are the
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

  const today = easternDate();
  const week1Due = followUpWindowOpen("week1") && week1AutoSendToday();
  const lastcallDue = followUpWindowOpen("lastcall") && lastCallAutoSendToday();

  const skipReason = (key: "week1" | "lastcall", on: string) =>
    !followUpWindowOpen(key)
      ? "outside send window"
      : `not the auto-send day (ET today ${today}, set for ${on})`;

  if (!week1Due && !lastcallDue) {
    return NextResponse.json({
      week1: { skipped: skipReason("week1", WEEK1_AUTO_SEND_ON) },
      lastcall: { skipped: skipReason("lastcall", LASTCALL_AUTO_SEND_ON) },
    });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Sequential, not parallel: each is a batched Resend call, and on Sept 30
  // only last call is due anyway.
  const send = async (key: "week1" | "lastcall") => {
    const r = await runReelFollowUpSend(admin, key, "cron");
    return "error" in r ? { skipped: r.error } : { ok: true, ...r };
  };
  const week1 = week1Due ? await send("week1") : { skipped: skipReason("week1", WEEK1_AUTO_SEND_ON) };
  const lastcall = lastcallDue ? await send("lastcall") : { skipped: skipReason("lastcall", LASTCALL_AUTO_SEND_ON) };

  return NextResponse.json({ ok: true, week1, lastcall });
}
