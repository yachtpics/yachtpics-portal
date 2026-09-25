import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { logEmail } from "@/lib/logEmail";
import { unsubscribeHeaders } from "@/lib/unsubscribe";
import {
  followUpHtml, followUpSubject, readReelStats,
  followUpWindowOpen, type FollowUpKey,
} from "@/lib/reelFollowUpEmail";
import { runReelFollowUpSend } from "@/lib/sendReelFollowUp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FROM = "Charlie & Samantha at YachtPics <hello@yachtpics.com>";

function isKey(v: unknown): v is FollowUpKey {
  return v === "week1" || v === "lastcall";
}

/**
 * POST /api/admin/reel-followup
 *   { key: "week1" | "lastcall", mode: "test" | "live", testEmail?, confirm? }
 *
 * No approve/schedule mode on purpose. Both of these carry live numbers and a
 * deadline, so they are read and then sent by hand — there is no version of
 * "arm it and forget it" that is safe for an email whose copy depends on what
 * happened yesterday.
 * Exception: week one (forced quiet, so no live numbers) also auto-sends once
 * via /api/cron/reel-followup on WEEK1_AUTO_SEND_ON — same send function, same
 * email_log dedup, so a hand send here first means the cron skips everyone.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin, userId } = auth;

  let body: { key?: string; mode?: string; testEmail?: string; confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const key = body.key;
  if (!isKey(key)) return NextResponse.json({ error: "Unknown follow-up" }, { status: 400 });

  // A test copy to one address. Never logged under the campaign type, so it
  // can't take the recipient out of the real send.
  if (body.mode === "test") {
    const { data: me } = await admin
      .from("profiles")
      .select("first_name, display_email, unsubscribe_token")
      .eq("id", userId)
      .single();
    const to = body.testEmail || me?.display_email;
    if (!to) return NextResponse.json({ error: "No address to send the test to" }, { status: 400 });

    const stats = await readReelStats(admin);
    const subject = followUpSubject(key, stats);
    const token = me?.unsubscribe_token ?? undefined;
    const html = followUpHtml(key, { firstName: me?.first_name ?? "there", stats, unsubToken: token });

    let ok = false;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to, subject: `[TEST] ${subject}`, html, headers: token ? unsubscribeHeaders(token) : {} }),
      });
      ok = res.ok;
    } catch { ok = false; }

    await logEmail({
      emailType: "announcement_test",
      recipientEmail: to,
      subject,
      status: ok ? "sent" : "failed",
      sentBy: userId,
    });

    return ok
      ? NextResponse.json({ ok: true, to, subject, stats })
      : NextResponse.json({ error: "Test send failed" }, { status: 500 });
  }

  if (body.mode === "live") {
    if (body.confirm !== true) return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
    if (!followUpWindowOpen(key)) {
      return NextResponse.json({ error: "Outside this follow-up's send window." }, { status: 400 });
    }
    const result = await runReelFollowUpSend(admin, key, userId);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
}
