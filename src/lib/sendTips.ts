import type { SupabaseClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";
import { unsubscribeHeaders } from "@/lib/unsubscribe";
import { TIPS, tipEmailType, tipApprovalKey, tipEmailHtml } from "@/lib/portalTips";

const FROM = "Charlie & Samantha at YachtPics <hello@yachtpics.com>";
const DAY = 86_400_000;
// Slightly under 7 days so a weekly cron never skips a user for being a few
// minutes early.
const PACE_MS = 6.5 * DAY;

type Recipient = {
  id: string;
  first_name: string | null;
  display_email: string | null;
  role: string | null;
  unsubscribe_token: string | null;
};

async function sendOne(to: string, subject: string, html: string, headers: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html, headers }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type TipsResult = {
  recipients: number;
  sent: number;
  failed: number;
  pacedSkipped: number;
  finishedSkipped: number;
  notApprovedSkipped: number;
};

/**
 * Sends each eligible recipient the NEXT tip they haven't received yet, as long
 * as: (a) it's been ~a week since their last tip, (b) that next tip is approved.
 * One tip per recipient per run. Existing users move together (broadcast); new
 * signups start at tip 1 whenever they first qualify (drip).
 */
export async function runTipsDrip(admin: SupabaseClient, sentBy: string): Promise<TipsResult> {
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, first_name, display_email, role, unsubscribe_token, email_opt_out")
    .in("role", ["broker", "assistant"])
    .eq("email_opt_out", false);
  const recipients = (profiles ?? []).filter((p) => !!p.display_email) as Recipient[];

  // Per-user tip history from the email log.
  const tipTypes = TIPS.map((t) => tipEmailType(t.slug));
  const { data: logs } = await admin
    .from("email_log")
    .select("recipient_id, email_type, sent_at")
    .in("email_type", tipTypes)
    .eq("status", "sent");
  const received = new Map<string, Set<string>>();
  const lastSentAt = new Map<string, number>();
  for (const l of logs ?? []) {
    const rid = l.recipient_id as string | null;
    if (!rid) continue;
    if (!received.has(rid)) received.set(rid, new Set());
    received.get(rid)!.add(l.email_type as string);
    const t = new Date(l.sent_at as string).getTime();
    if (!lastSentAt.has(rid) || t > lastSentAt.get(rid)!) lastSentAt.set(rid, t);
  }

  // Which tips are approved to send.
  const { data: settings } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", TIPS.map((t) => tipApprovalKey(t.slug)));
  const approved = new Set((settings ?? []).filter((s) => s.value === true).map((s) => s.key));

  const now = Date.now();
  const result: TipsResult = { recipients: recipients.length, sent: 0, failed: 0, pacedSkipped: 0, finishedSkipped: 0, notApprovedSkipped: 0 };

  // Build the work list (one tip per due recipient), then send in small batches.
  type Job = { r: Recipient; tipIndex: number };
  const jobs: Job[] = [];
  for (const r of recipients) {
    const last = lastSentAt.get(r.id);
    if (last && now - last < PACE_MS) { result.pacedSkipped++; continue; }
    const got = received.get(r.id) ?? new Set<string>();
    const nextIndex = TIPS.findIndex((t) => !got.has(tipEmailType(t.slug)));
    if (nextIndex === -1) { result.finishedSkipped++; continue; }
    if (!approved.has(tipApprovalKey(TIPS[nextIndex].slug))) { result.notApprovedSkipped++; continue; }
    jobs.push({ r, tipIndex: nextIndex });
  }

  const BATCH = 5;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async ({ r, tipIndex }) => {
        const tip = TIPS[tipIndex];
        const email = r.display_email as string;
        const token = r.unsubscribe_token ?? undefined;
        const html = tipEmailHtml(tip, { firstName: r.first_name ?? "there", unsubToken: token });
        const ok = await sendOne(email, tip.subject, html, token ? unsubscribeHeaders(token) : {});
        await logEmail({
          emailType: tipEmailType(tip.slug),
          recipientEmail: email,
          recipientRole: r.role === "assistant" ? "assistant" : "broker",
          recipientId: r.id,
          subject: tip.subject,
          status: ok ? "sent" : "failed",
          sentBy,
        });
        if (ok) result.sent++;
        else result.failed++;
      })
    );
  }

  return result;
}
