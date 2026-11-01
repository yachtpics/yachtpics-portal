import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import {
  MONTHLY_REPORT_AUTO_KEY, isCompletedMonth, isMonth, sendMonthlyReport, sendMonthlyReportTest,
} from "@/lib/monthlyReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Looks up ~140 brokers' access, makes cover thumbs, batches ~170 emails.
export const maxDuration = 300;

/**
 * POST /api/admin/monthly-report — "Your boats this month" (admins only;
 * driven from /admin/announce/monthly-report).
 *   { action: "test", month, key? }                 a test copy to the signed-in admin
 *   { action: "send", month, keys, confirm: "SEND" } send (deduped per recipient per month)
 *   { action: "auto", on }                          the "Schedule automatically" switch
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const svc = auth.admin;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; month?: unknown; key?: unknown; keys?: unknown; confirm?: unknown; on?: unknown };
  const month = body.month;

  try {
    if (body.action === "auto") {
      const on = body.on === true;
      const { error } = await svc
        .from("app_settings")
        .upsert({ key: MONTHLY_REPORT_AUTO_KEY, value: on, updated_at: new Date().toISOString(), updated_by: auth.userId });
      if (error) return NextResponse.json({ error: "Could not save the setting." }, { status: 500 });
      return NextResponse.json({ ok: true, on });
    }

    if (!isMonth(month) || !isCompletedMonth(month)) {
      return NextResponse.json({ error: "Pick a month that has finished." }, { status: 400 });
    }

    if (body.action === "test") {
      const { data: me } = await svc.from("profiles").select("display_email").eq("id", auth.userId).maybeSingle();
      let to = (me?.display_email as string | null) ?? null;
      if (!to) {
        const { data } = await svc.auth.admin.getUserById(auth.userId);
        to = data.user?.email ?? null;
      }
      if (!to) return NextResponse.json({ error: "Your account has no email address." }, { status: 400 });
      const key = typeof body.key === "string" ? body.key : undefined;
      const r = await sendMonthlyReportTest(svc, month, to, auth.userId, key);
      return r.ok ? NextResponse.json({ ok: true, to }) : NextResponse.json({ error: r.error }, { status: 500 });
    }

    if (body.action === "send") {
      if (body.confirm !== "SEND") return NextResponse.json({ error: "Type SEND to confirm." }, { status: 400 });
      const keys = Array.isArray(body.keys)
        ? body.keys.filter((k): k is string => typeof k === "string" && /^[ab]:[0-9a-f-]{36}$/i.test(k))
        : [];
      if (keys.length === 0) return NextResponse.json({ error: "No recipients ticked." }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await sendMonthlyReport(svc, month, keys, auth.userId)) });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
