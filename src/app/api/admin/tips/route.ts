import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { logEmail } from "@/lib/logEmail";
import { unsubscribeHeaders } from "@/lib/unsubscribe";
import { TIP_BY_SLUG, tipApprovalKey, tipEmailHtml } from "@/lib/portalTips";
import { runTipsDrip } from "@/lib/sendTips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FROM = "Charlie & Samantha at YachtPics <hello@yachtpics.com>";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin, userId } = auth;

  let body: { mode?: string; slug?: string; testEmail?: string; confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const mode = body.mode;
  const tip = body.slug ? TIP_BY_SLUG[body.slug] : undefined;

  // Approve / hold a specific tip.
  if (mode === "approve" || mode === "unapprove") {
    if (!tip) return NextResponse.json({ error: "Unknown tip" }, { status: 400 });
    const approved = mode === "approve";
    const { error } = await admin
      .from("app_settings")
      .upsert({ key: tipApprovalKey(tip.slug), value: approved, updated_at: new Date().toISOString(), updated_by: userId });
    if (error) return NextResponse.json({ error: "Could not save approval" }, { status: 500 });
    return NextResponse.json({ ok: true, slug: tip.slug, approved });
  }

  // Send a single test copy of a tip to the admin (or supplied address).
  if (mode === "test") {
    if (!tip) return NextResponse.json({ error: "Unknown tip" }, { status: 400 });
    const { data: me } = await admin
      .from("profiles")
      .select("first_name, display_email, unsubscribe_token")
      .eq("id", userId)
      .single();
    const to = body.testEmail || me?.display_email;
    if (!to) return NextResponse.json({ error: "No address to send the test to" }, { status: 400 });
    const token = me?.unsubscribe_token ?? undefined;
    const html = tipEmailHtml(tip, { firstName: me?.first_name ?? "there", unsubToken: token });
    let ok = false;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to, subject: `[TEST] ${tip.subject}`, html, headers: token ? unsubscribeHeaders(token) : {} }),
      });
      ok = res.ok;
    } catch { ok = false; }
    await logEmail({ emailType: "tip_test", recipientEmail: to, subject: tip.subject, status: ok ? "sent" : "failed", sentBy: userId });
    return ok ? NextResponse.json({ ok: true, to }) : NextResponse.json({ error: "Test send failed" }, { status: 500 });
  }

  // Run the drip immediately (manual trigger / fallback for the weekly cron).
  if (mode === "run") {
    if (body.confirm !== true) return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
    const result = await runTipsDrip(admin, userId);
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
}
