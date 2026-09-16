import type { SupabaseClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";
import { unsubscribeHeaders } from "@/lib/unsubscribe";
import { sendResendBatch, type BatchEmail } from "@/lib/sendEmailBatch";
import {
  followUpHtml, followUpSubject, readReelStats,
  FOLLOWUP_TYPE, followUpWindowOpen, type FollowUpKey,
} from "@/lib/reelFollowUpEmail";

const FROM = "Charlie & Samantha at YachtPics <hello@yachtpics.com>";

type Recipient = {
  id: string;
  first_name: string | null;
  display_email: string | null;
  role: string | null;
  unsubscribe_token: string | null;
};

export type FollowUpResult = {
  eligible: number; sent: number; skipped: number; failed: number; subject: string;
};

/**
 * Send one of the two Reel follow-ups. Mirrors runAnnouncementSend — same
 * audience, same dedup via email_log, same batched Resend call — with two
 * differences: the campaign type comes from the key, and the numbers are read
 * once up front so every copy quotes the same figures.
 *
 * The send window is enforced here rather than only in the UI, because the
 * cost of a "two days left" email arriving a week late is paid by 148 people
 * and can't be taken back.
 */
export async function runReelFollowUpSend(
  admin: SupabaseClient,
  key: FollowUpKey,
  sentBy: string,
): Promise<FollowUpResult | { error: string }> {
  if (!followUpWindowOpen(key)) {
    return { error: "Outside this follow-up's send window." };
  }

  const emailType = FOLLOWUP_TYPE[key];
  const stats = await readReelStats(admin);
  const subject = followUpSubject(key, stats);

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, first_name, display_email, role, unsubscribe_token, email_opt_out")
    .in("role", ["broker", "assistant"])
    .eq("email_opt_out", false);

  const recipients = (profiles ?? []).filter((p) => !!p.display_email) as Recipient[];

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
      html: followUpHtml(key, { firstName: r.first_name ?? "there", stats, unsubToken: token }),
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
        sentBy,
      });
    })
  );

  return { eligible: recipients.length, sent, skipped: recipients.length - queue.length, failed, subject };
}
