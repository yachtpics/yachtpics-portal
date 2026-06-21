import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { logEmail } from "@/lib/logEmail";
import { unsubscribeHeaders } from "@/lib/unsubscribe";
import { announcementHtml, ANNOUNCEMENT_TYPE, ANNOUNCEMENT_SUBJECT } from "@/lib/announcementEmail";
import { runAnnouncementSend } from "@/lib/sendAnnouncement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPROVE_KEY = `${ANNOUNCEMENT_TYPE}_approved`;
const FROM = "YachtPics <hello@yachtpics.com>";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin, userId } = auth;

  let body: { mode?: string; testEmail?: string; confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const mode = body.mode;

  // Send a single test copy to the admin (or a supplied address) — never logged
  // as the real campaign, so it can't affect dedup.
  if (mode === "test") {
    const { data: me } = await admin
      .from("profiles")
      .select("first_name, display_email, unsubscribe_token")
      .eq("id", userId)
      .single();
    const to = body.testEmail || me?.display_email;
    if (!to) return NextResponse.json({ error: "No address to send the test to" }, { status: 400 });
    const token = me?.unsubscribe_token ?? undefined;
    const html = announcementHtml({ firstName: me?.first_name ?? "there", unsubToken: token });
    let ok = false;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to, subject: `[TEST] ${ANNOUNCEMENT_SUBJECT}`, html, headers: token ? unsubscribeHeaders(token) : {} }),
      });
      ok = res.ok;
    } catch { ok = false; }
    await logEmail({ emailType: "announcement_test", recipientEmail: to, subject: ANNOUNCEMENT_SUBJECT, status: ok ? "sent" : "failed", sentBy: userId });
    return ok
      ? NextResponse.json({ ok: true, to })
      : NextResponse.json({ error: "Test send failed" }, { status: 500 });
  }

  // Approve / hold the scheduled Monday send.
  if (mode === "approve" || mode === "unapprove") {
    const approved = mode === "approve";
    const { error } = await admin
      .from("app_settings")
      .upsert({ key: APPROVE_KEY, value: approved, updated_at: new Date().toISOString(), updated_by: userId });
    if (error) return NextResponse.json({ error: "Could not save approval" }, { status: 500 });
    return NextResponse.json({ ok: true, approved });
  }

  // Manual immediate send-to-all (fallback / override). Requires explicit confirm.
  if (mode === "live") {
    if (body.confirm !== true) return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
    const result = await runAnnouncementSend(admin, userId);
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
}
