import { createClient } from "@supabase/supabase-js";

export interface EmailLogEntry {
  /** Stable machine type, e.g. "broker_invite", "photos_ready", "client_send". */
  emailType: string;
  recipientEmail: string;
  recipientRole?: "broker" | "assistant" | "client" | null;
  recipientId?: string | null;
  /** The broker who owns the related listing (for grouping), if known. */
  brokerId?: string | null;
  listingId?: string | null;
  subject?: string | null;
  status?: "sent" | "failed";
  error?: string | null;
  /** The signed-in user who triggered the send, if any. */
  sentBy?: string | null;
  metadata?: Record<string, unknown> | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records a sent (or failed) email in the email_log table. Best-effort:
 * never throws and never blocks the caller — logging must not break sending.
 */
export async function logEmail(entry: EmailLogEntry): Promise<void> {
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    // sent_by is a uuid column. Cron jobs pass a label like "cron" for the
    // actor — that's not a uuid, so writing it made the whole insert fail and
    // the log row vanish (tips + announce were silently never logged). Store a
    // uuid when we have one, otherwise null and keep the label in metadata.
    const sentByUuid = entry.sentBy && UUID_RE.test(entry.sentBy) ? entry.sentBy : null;
    const metadata =
      entry.sentBy && !sentByUuid
        ? { ...(entry.metadata ?? {}), sentByLabel: entry.sentBy }
        : entry.metadata ?? null;
    await admin.from("email_log").insert({
      email_type: entry.emailType,
      recipient_email: entry.recipientEmail,
      recipient_role: entry.recipientRole ?? null,
      recipient_id: entry.recipientId ?? null,
      broker_id: entry.brokerId ?? null,
      listing_id: entry.listingId ?? null,
      subject: entry.subject ?? null,
      status: entry.status ?? "sent",
      error: entry.error ?? null,
      sent_by: sentByUuid,
      metadata,
    });
  } catch (e) {
    console.error("logEmail failed:", e);
  }
}
