import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { todayET } from "@/lib/reviewReel";
import { monthlyAutoOn, monthlyBatchSent, previousMonthET, sendMonthlyReport } from "@/lib/monthlyReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * "Your boats this month" — automatic send. Called every day by
 * /api/cron/daily (13:00 UTC ≈ 9 AM ET) and gated three ways, all of which
 * must pass:
 *   1. the "Schedule automatically" switch (app_settings monthly_report_auto)
 *      is on — Charlie turns it on at /admin/announce/monthly-report;
 *   2. today is the 1st in Eastern time;
 *   3. nothing of last month's batch has gone out yet (if Charlie sent it by
 *      hand, the cron leaves it alone — it never mails people he unticked).
 * The send itself is deduped per recipient in email_log.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  const authHeader = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  if (!(await monthlyAutoOn(svc))) return NextResponse.json({ ok: true, skipped: "switch off" });
  const today = todayET();
  if (today.slice(8, 10) !== "01") return NextResponse.json({ ok: true, skipped: `not the 1st (${today})` });
  const month = previousMonthET();
  const already = await monthlyBatchSent(svc, month);
  if (already > 0) return NextResponse.json({ ok: true, skipped: `${month} already sent (${already})` });

  const result = await sendMonthlyReport(svc, month, null, "cron");
  return NextResponse.json({ ok: true, month, ...result });
}
