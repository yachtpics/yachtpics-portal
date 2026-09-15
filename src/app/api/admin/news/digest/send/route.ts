import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { logEmail } from "@/lib/logEmail";
import { unsubscribeHeaders } from "@/lib/unsubscribe";
import { sendResendBatch, type BatchEmail } from "@/lib/sendEmailBatch";
import { DIGEST_SELECT, digestEmailHtml, digestEmailType, renderDigestHtml, type DigestRow } from "@/lib/newsDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FROM = "Charlie & Samantha at YachtPics <hello@yachtpics.com>";

type Recipient = {
  id: string;
  first_name: string | null;
  display_email: string | null;
  role: string | null;
  unsubscribe_token: string | null;
};

/**
 * Send the weekly piece.
 *
 * Marketing-class, exactly like the announcement: brokers and assistants who
 * haven't opted out, an unsubscribe footer in every copy, the List-Unsubscribe
 * headers Gmail wants, and one email_log row each under
 * `news_digest_<week_start>`. That type is also the dedup key — a second click
 * on "Approve & send" finds everyone already logged and sends nothing.
 *
 * `{ testOnly: true }` sends one copy to the signed-in admin instead. It is
 * logged under a different type so it can never affect the real dedup.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin, userId } = auth;

  let body: { id?: string; testOnly?: boolean; confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "Which digest?" }, { status: 400 });

  const { data: current, error: readError } = await admin
    .from("news_digests")
    .select(DIGEST_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "That digest is gone" }, { status: 404 });

  const row = current as unknown as DigestRow;
  const html = renderDigestHtml({ body_md: row.body_md });
  if (!html) return NextResponse.json({ error: "There's nothing to send yet" }, { status: 400 });

  const subject = row.title;

  // ── One copy, to me ─────────────────────────────────────────────────────
  if (body.testOnly === true) {
    const { data: me } = await admin
      .from("profiles")
      .select("first_name, display_email, unsubscribe_token")
      .eq("id", userId)
      .single();
    const to = me?.display_email as string | null | undefined;
    if (!to) return NextResponse.json({ error: "Your admin profile has no contact email to send to" }, { status: 400 });

    const token = (me?.unsubscribe_token as string | null) ?? undefined;
    const testHtml = digestEmailHtml({
      firstName: (me?.first_name as string | null) ?? "there",
      digest: { title: row.title, intro: row.intro, body_md: row.body_md, html },
      unsubToken: token,
    });

    let ok = false;
    let error: string | null = null;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to,
          subject: `[TEST] ${subject}`,
          html: testHtml,
          headers: token ? unsubscribeHeaders(token) : {},
        }),
      });
      ok = res.ok;
      if (!ok) error = `Resend returned ${res.status}`;
    } catch (e) {
      ok = false;
      error = e instanceof Error ? e.message : String(e);
    }

    await logEmail({
      emailType: "news_digest_test",
      recipientEmail: to,
      subject,
      status: ok ? "sent" : "failed",
      error: ok ? null : error,
      sentBy: userId,
      metadata: { week_start: row.week_start },
    });

    return ok
      ? NextResponse.json({ ok: true, testOnly: true, to })
      : NextResponse.json({ error: error ?? "Test send failed" }, { status: 500 });
  }

  // ── The real send ───────────────────────────────────────────────────────
  if (body.confirm !== true) return NextResponse.json({ error: "Confirmation required" }, { status: 400 });

  const emailType = digestEmailType(row.week_start);

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, first_name, display_email, role, unsubscribe_token, email_opt_out")
    .in("role", ["broker", "assistant"])
    .eq("email_opt_out", false);
  const recipients = (profiles ?? []).filter((p) => !!p.display_email) as Recipient[];

  // Who already has this week's piece (dedup across re-clicks).
  const { data: priorLogs } = await admin
    .from("email_log")
    .select("recipient_id")
    .eq("email_type", emailType)
    .eq("status", "sent");
  const alreadySent = new Set((priorLogs ?? []).map((l) => l.recipient_id).filter(Boolean) as string[]);

  const queue = recipients.filter((r) => !alreadySent.has(r.id));

  const messages: BatchEmail[] = queue.map((r) => {
    const token = r.unsubscribe_token ?? undefined;
    return {
      from: FROM,
      to: r.display_email as string,
      subject,
      html: digestEmailHtml({
        firstName: r.first_name ?? "there",
        digest: { title: row.title, intro: row.intro, body_md: row.body_md, html },
        unsubToken: token,
      }),
      headers: token ? unsubscribeHeaders(token) : undefined,
    };
  });

  const batchResults = await sendResendBatch(messages);

  let sent = 0;
  let failed = 0;
  await Promise.all(
    queue.map((r, i) => {
      const ok = batchResults[i]?.ok ?? false;
      if (ok) sent++;
      else failed++;
      return logEmail({
        emailType,
        recipientEmail: r.display_email as string,
        recipientRole: r.role === "assistant" ? "assistant" : "broker",
        recipientId: r.id,
        subject,
        status: ok ? "sent" : "failed",
        error: ok ? null : (batchResults[i]?.error ?? "Send failed"),
        sentBy: userId,
        metadata: { week_start: row.week_start },
      });
    })
  );

  // Approve-on-send: pressing "Approve & send" on a draft publishes it too, so
  // the website and the inbox always carry the same words.
  const markSent = sent > 0 || queue.length === 0;
  const { data: updated, error: updateError } = await admin
    .from("news_digests")
    .update({
      html,
      status: markSent ? "sent" : "approved",
      approved_at: row.approved_at ?? new Date().toISOString(),
      sent_at: markSent ? (row.sent_at ?? new Date().toISOString()) : row.sent_at,
    })
    .eq("id", id)
    .select(DIGEST_SELECT)
    .single();

  if (updateError) {
    return NextResponse.json(
      { ok: true, warning: `Sent, but the digest status didn't save: ${updateError.message}`, eligible: recipients.length, sent, failed, skipped: recipients.length - queue.length },
      { status: 200 }
    );
  }

  return NextResponse.json({
    ok: true,
    digest: updated,
    eligible: recipients.length,
    sent,
    failed,
    skipped: recipients.length - queue.length,
  });
}
