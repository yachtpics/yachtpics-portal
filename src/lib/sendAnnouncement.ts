import type { SupabaseClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";
import { unsubscribeHeaders } from "@/lib/unsubscribe";
import { GENERAL_ANNOUNCEMENT_CAMPAIGN, type AnnouncementCampaign } from "@/lib/announcementEmail";
import { sendResendBatch, type BatchEmail } from "@/lib/sendEmailBatch";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { isDepthLooksSubscriber } from "@/lib/depthLooksRelease";

const FROM = "Charlie & Samantha at YachtPics <hello@yachtpics.com>";

type Recipient = {
  id: string;
  first_name: string | null;
  display_email: string | null;
  role: string | null;
  unsubscribe_token: string | null;
};

export type AnnouncementResult = { eligible: number; sent: number; skipped: number; failed: number };

export type AnnouncementPlan = {
  /** Everyone the campaign is for (opted in, has an email, in the audience). */
  recipients: Recipient[];
  /** Who would be sent to now (recipients minus the two skip groups below). */
  queue: Recipient[];
  /** Already got THIS campaign. */
  skippedAlreadySent: number;
  /** Already got one of campaign.excludeSentTypes (e.g. the early-access email). */
  skippedExcluded: number;
};

/**
 * Broker ids whose effective access (own plan or the brokerage's Office plan)
 * counts as subscriber for the depth looks — isDepthLooksSubscriber, the same
 * test the reel page uses. Looked up per broker (~150), a few at a time.
 */
export async function getSubscriberBrokerIds(admin: SupabaseClient): Promise<string[]> {
  const { data: brokers } = await admin.from("profiles").select("id").eq("role", "broker");
  const ids = (brokers ?? []).map((b) => b.id as string);
  const out: string[] = [];
  const CHUNK = 10;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const statuses = await Promise.all(
      slice.map((id) => getEffectiveAccessStatus(admin, id).then((r) => r.status).catch(() => null))
    );
    slice.forEach((id, j) => {
      if (isDepthLooksSubscriber(statuses[j])) out.push(id);
    });
  }
  return out;
}

/**
 * Who a campaign goes to and who would be sent to right now. Shared by the
 * send and /admin/announce so the page's counts match what a send would do.
 *   • audience "all": every broker & assistant.
 *   • audience "subscribers": subscriber brokers (getSubscriberBrokerIds) plus
 *     every assistant linked to one of them in broker_assistants (an assistant
 *     for several brokers qualifies if any one of them is a subscriber).
 * Both: role broker/assistant, email_opt_out = false, has display_email.
 */
export async function planAnnouncement(admin: SupabaseClient, campaign: AnnouncementCampaign): Promise<AnnouncementPlan> {
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, first_name, display_email, role, unsubscribe_token, email_opt_out")
    .in("role", ["broker", "assistant"])
    .eq("email_opt_out", false);

  let recipients = (profiles ?? []).filter((p) => !!p.display_email) as Recipient[];

  if (campaign.audience === "subscribers") {
    const brokerIds = await getSubscriberBrokerIds(admin);
    const allowed = new Set<string>(brokerIds);
    if (brokerIds.length > 0) {
      const { data: links } = await admin
        .from("broker_assistants")
        .select("assistant_id, broker_id")
        .in("broker_id", brokerIds);
      (links ?? []).forEach((l) => {
        if (l.assistant_id) allowed.add(l.assistant_id as string);
      });
    }
    recipients = recipients.filter((r) => allowed.has(r.id));
  }

  // Who already got this campaign (dedup across re-runs / cron + manual).
  const { data: priorLogs } = await admin
    .from("email_log")
    .select("recipient_id")
    .eq("email_type", campaign.type)
    .eq("status", "sent");
  const alreadySent = new Set((priorLogs ?? []).map((l) => l.recipient_id).filter(Boolean) as string[]);

  // Who got a campaign this one stands aside for (the early-access email).
  const excluded = new Set<string>();
  if (campaign.excludeSentTypes.length > 0) {
    const { data: exLogs } = await admin
      .from("email_log")
      .select("recipient_id")
      .in("email_type", campaign.excludeSentTypes)
      .eq("status", "sent");
    (exLogs ?? []).forEach((l) => {
      if (l.recipient_id) excluded.add(l.recipient_id as string);
    });
  }

  let skippedAlreadySent = 0;
  let skippedExcluded = 0;
  const queue = recipients.filter((r) => {
    if (alreadySent.has(r.id)) { skippedAlreadySent++; return false; }
    if (excluded.has(r.id)) { skippedExcluded++; return false; }
    return true;
  });

  return { recipients, queue, skippedAlreadySent, skippedExcluded };
}

/**
 * Sends a campaign to everyone in its audience who hasn't opted out and hasn't
 * already received it (deduped via email_log), skipping anyone who got one of
 * its excludeSentTypes. Safe to call more than once. Defaults to the general
 * launch campaign.
 */
export async function runAnnouncementSend(
  admin: SupabaseClient,
  sentBy: string,
  campaign: AnnouncementCampaign = GENERAL_ANNOUNCEMENT_CAMPAIGN
): Promise<AnnouncementResult> {
  const { recipients, queue } = await planAnnouncement(admin, campaign);

  // One batched send for the whole queue (Resend batch API, ≤100 per request).
  const messages: BatchEmail[] = queue.map((r) => {
    const token = r.unsubscribe_token ?? undefined;
    return {
      from: FROM,
      to: r.display_email as string,
      subject: campaign.subject,
      html: campaign.html({ firstName: r.first_name ?? "there", unsubToken: token }),
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
        emailType: campaign.type,
        recipientEmail: r.display_email as string,
        recipientRole: r.role === "assistant" ? "assistant" : "broker",
        recipientId: r.id,
        subject: campaign.subject,
        status: ok ? "sent" : "failed",
        error: ok ? null : (batchResults[i]?.error ?? "Send failed"),
        sentBy,
      });
    })
  );

  return { eligible: recipients.length, sent, skipped: recipients.length - queue.length, failed };
}
