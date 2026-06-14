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
      sent_by: entry.sentBy ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch (e) {
    console.error("logEmail failed:", e);
  }
}
