import type { SupabaseClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";
import { unsubscribeHeaders } from "@/lib/unsubscribe";
import { announcementHtml, ANNOUNCEMENT_TYPE, ANNOUNCEMENT_SUBJECT } from "@/lib/announcementEmail";
import { sendResendBatch, type BatchEmail } from "@/lib/sendEmailBatch";

const FROM = "Charlie & Samantha at YachtPics <hello@yachtpics.com>";

type Recipient = {
  id: string;
  first_name: string | null;
  display_email: string | null;
  role: string | null;
  unsubscribe_token: string | null;
};

export type AnnouncementResult = { eligible: number; sent: number; skipped: number; failed: number };

/**
 * Sends the product announcement to every broker & assistant who hasn't opted
 * out and hasn't already received it (deduped via email_log). Safe to call more
 * than once — already-sent recipients are skipped.
 */
export async function runAnnouncementSend(admin: SupabaseClient, sentBy: string): Promise<AnnouncementResult> {
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, first_name, display_email, role, unsubscribe_token, email_opt_out")
    .in("role", ["broker", "assistant"])
    .eq("email_opt_out", false);

  const recipients = (profiles ?? []).filter((p) => !!p.display_email) as Recipient[];

  // Who already got this campaign (dedup across re-runs / cron + manual).
  const { data: priorLogs } = await admin
    .from("email_log")
    .select("recipient_id")
    .eq("email_type", ANNOUNCEMENT_TYPE)
    .eq("status", "sent");
  const alreadySent = new Set((priorLogs ?? []).map((l) => l.recipient_id).filter(Boolean) as string[]);

  const queue = recipients.filter((r) => !alreadySent.has(r.id));

  // One batched send for the whole queue (Resend batch API, ≤100 per request).
  const messages: BatchEmail[] = queue.map((r) => {
    const token = r.unsubscribe_token ?? undefined;
    return {
      from: FROM,
      to: r.display_email as string,
      subject: ANNOUNCEMENT_SUBJECT,
      html: announcementHtml({ firstName: r.first_name ?? "there", unsubToken: token }),
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
        emailType: ANNOUNCEMENT_TYPE,
        recipientEmail: r.display_email as string,
        recipientRole: r.role === "assistant" ? "assistant" : "broker",
        recipientId: r.id,
        subject: ANNOUNCEMENT_SUBJECT,
        status: ok ? "sent" : "failed",
        error: ok ? null : (batchResults[i]?.error ?? "Send failed"),
        sentBy,
      });
    })
  );

  return { eligible: recipients.length, sent, skipped: recipients.length - queue.length, failed };
}
