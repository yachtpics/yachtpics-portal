/**
 * The payment reminder email — a courtesy nudge, not a demand. Most of the
 * people getting it are long-standing broker clients, so it stays short and
 * polite and never says "overdue" or "late".
 *
 * Same path as the invoice email (invoiceEmail.ts): Resend from
 * hello@yachtpics.com with the login's from-name and per-brand reply-to, the
 * invoice PDF attached, the "View invoice" button to the public /inv page,
 * the same How to pay box and Notes + Terms footer. Logged in email_log as
 * `billing_reminder` and tracked like the invoice email.
 */
import { logEmail } from "@/lib/logEmail";
import { newEmailLogId, trackEmailHtml } from "@/lib/emailTracking";
import { publicInvoiceUrl, type InvoiceBundle } from "./invoices";
import { buildInvoicePdf } from "./invoicePdf";
import { emailFooterBlockHtml, emailLogoHtml, emailPayBlockHtml, emailShellHtml, esc, postBillingEmail } from "./invoiceEmail";
import { fmtDate, fmtMoney } from "./types";

export function reminderEmailSubject(b: InvoiceBundle): string {
  return `Reminder: Invoice ${b.invoice.number ?? ""} from ${b.brand.display_name}`.replace(/\s+/g, " ").trim();
}

/** `greet`: see invoiceEmailHtml (left out = the client's first name). */
export function reminderEmailHtml(b: InvoiceBundle, greet?: string): string {
  const { invoice: inv, client, settings } = b;
  const first = greet !== undefined ? greet : (client?.first_name || "").trim().split(" ")[0];
  const url = publicInvoiceUrl(inv.public_token);
  const signName = settings.fromName || settings.displayName;
  return emailShellHtml(b, `${emailLogoHtml(b)}
<p style="margin:0 0 14px;font-size:15px;color:#111827;line-height:1.6;">${first ? `Hi ${esc(first)},` : "Hello,"}</p>
<p style="margin:0 0 22px;font-size:15px;color:#374151;line-height:1.6;">Just a friendly reminder that invoice ${esc(inv.number)} for ${esc(fmtMoney(inv.balance_due))}, dated ${esc(fmtDate(inv.issue_date))}, is still open.</p>
<p style="margin:0;"><a href="${esc(url)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">View invoice</a></p>
<p style="margin:12px 0 0;font-size:13px;color:#6b7280;">A copy of the invoice is attached.</p>
${emailPayBlockHtml(b)}
<p style="margin:24px 0 0;font-size:14px;color:#374151;line-height:1.6;">If you&rsquo;ve already sent payment, thank you &mdash; please disregard this note.</p>
<p style="margin:22px 0 0;font-size:14px;color:#374151;line-height:1.6;">Thank you,<br>${esc(signName)}${settings.phone ? `<br><span style="color:#6b7280;">${esc(settings.phone)}</span>` : ""}</p>
${emailFooterBlockHtml(b)}`);
}

/**
 * Send one reminder for this invoice to everyone in `to` (one email, all in
 * the To line — the same people the invoice went to). The PDF is attached
 * when it can be built; if it can't, the reminder still goes with the View
 * invoice link.
 */
export async function sendReminderEmail(
  b: InvoiceBundle,
  to: string[],
  day: number,
  greet?: string
): Promise<{ ok: boolean; error: string | null; emailLogId: string; resendId: string | null }> {
  const subject = reminderEmailSubject(b);
  const logId = newEmailLogId();
  const html = trackEmailHtml(reminderEmailHtml(b, greet), logId);
  let pdf: Uint8Array | null = null;
  try {
    pdf = await buildInvoicePdf(b);
  } catch {
    pdf = null;
  }
  const r = await postBillingEmail(b, { to: to.length === 1 ? to[0] : to, subject, html, pdf });
  await logEmail({
    id: logId,
    emailType: "billing_reminder",
    recipientEmail: to.join(", "),
    recipientRole: "client",
    subject,
    status: r.ok ? "sent" : "failed",
    error: r.message,
    sentBy: "billing_reminders",
    listingId: b.invoice.listing_id,
    metadata: { invoiceId: b.invoice.id, number: b.invoice.number, brand: b.brand.key, ownerId: b.invoice.owner_id, day, pdf: !!pdf, recipients: to },
  });
  return { ok: r.ok, error: r.message, emailLogId: logId, resendId: r.id };
}
