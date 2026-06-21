import type { SupabaseClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";
import { unsubscribeHeaders } from "@/lib/unsubscribe";
import { announcementHtml, ANNOUNCEMENT_TYPE, ANNOUNCEMENT_SUBJECT } from "@/lib/announcementEmail";

const FROM = "YachtPics <hello@yachtpics.com>";

type Recipient = {
  id: string;
  first_name: string | null;
  display_email: string | null;
  role: string | null;
  unsubscribe_token: string | null;
};

async function sendOne(to: string, html: string, headers: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject: ANNOUNCEMENT_SUBJECT, html, headers }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

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

  let sent = 0;
  let failed = 0;
  const BATCH = 5;

  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (r) => {
        const email = r.display_email as string;
        const token = r.unsubscribe_token ?? undefined;
        const html = announcementHtml({ firstName: r.first_name ?? "there", unsubToken: token });
        const headers = token ? unsubscribeHeaders(token) : {};
        const ok = await sendOne(email, html, headers);
        await logEmail({
          emailType: ANNOUNCEMENT_TYPE,
          recipientEmail: email,
          recipientRole: r.role === "assistant" ? "assistant" : "broker",
          recipientId: r.id,
          subject: ANNOUNCEMENT_SUBJECT,
          status: ok ? "sent" : "failed",
          sentBy,
        });
        if (ok) sent++;
        else failed++;
      })
    );
  }

  return { eligible: recipients.length, sent, skipped: recipients.length - queue.length, failed };
}
