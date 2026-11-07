/**
 * The receipt email after an online payment ("Payment received — Invoice
 * YP-1012"). Same path as the invoice email (invoiceEmail.ts): Resend from
 * hello@yachtpics.com with the login's from-name and per-brand reply-to,
 * logo, Notes + Terms footer. The PDF is attached (it prints PAID once the
 * invoice is paid in full); if the PDF can't be built the receipt still goes.
 * Logged in email_log as `billing_receipt`.
 *
 * There was no receipt email before phase 3 — manual payments still send none.
 */
import { logEmail } from "@/lib/logEmail";
import { newEmailLogId, trackEmailHtml } from "@/lib/emailTracking";
import { publicInvoiceUrl, type InvoiceBundle } from "./invoices";
import { buildInvoicePdf } from "./invoicePdf";
import { emailFooterBlockHtml, emailLogoHtml, emailShellHtml, esc, postBillingEmail } from "./invoiceEmail";
import { fmtDate, fmtMoney, METHOD_LABEL, type PaymentMethod } from "./types";

export function receiptEmailSubject(b: InvoiceBundle): string {
  return `Payment received — Invoice ${b.invoice.number ?? ""}`.replace(/\s+/g, " ").trim();
}

/** `greet`: see invoiceEmailHtml (left out = the client's first name). */
export function receiptEmailHtml(b: InvoiceBundle, p: { amount: number; paidOn: string; method: PaymentMethod; via: string }, greet?: string): string {
  const { invoice: inv, client, settings } = b;
  const first = greet !== undefined ? greet : (client?.first_name || "").trim().split(" ")[0];
  const signName = settings.fromName || settings.displayName;
  const rest = inv.balance_due > 0.005
    ? `<p style="margin:14px 0 0;font-size:14px;color:#374151;">Remaining balance: <strong>${esc(fmtMoney(inv.balance_due))}</strong></p>`
    : `<p style="margin:14px 0 0;font-size:14px;color:#047857;font-weight:600;">Invoice ${esc(inv.number)} is paid in full.</p>`;
  return emailShellHtml(b, `${emailLogoHtml(b)}
<p style="margin:0 0 14px;font-size:15px;color:#111827;line-height:1.6;">${first ? `Hi ${esc(first)},` : "Hello,"}</p>
<p style="margin:0 0 22px;font-size:15px;color:#374151;line-height:1.6;">Thank you &mdash; we received your payment for invoice ${esc(inv.number)}.</p>
<table role="presentation" style="border-collapse:collapse;font-size:14px;color:#111827;">
<tr><td style="padding:3px 18px 3px 0;color:#6b7280;">Amount</td><td style="padding:3px 0;font-weight:600;">${esc(fmtMoney(p.amount))}</td></tr>
<tr><td style="padding:3px 18px 3px 0;color:#6b7280;">Date</td><td style="padding:3px 0;">${esc(fmtDate(p.paidOn))}</td></tr>
<tr><td style="padding:3px 18px 3px 0;color:#6b7280;">Method</td><td style="padding:3px 0;">${esc(METHOD_LABEL[p.method])} ${esc(p.via)}</td></tr>
</table>
${rest}
<p style="margin:24px 0 0;"><a href="${esc(publicInvoiceUrl(inv.public_token))}" style="color:#111827;font-size:14px;">View invoice</a></p>
<p style="margin:22px 0 0;font-size:14px;color:#374151;line-height:1.6;">Thank you,<br>${esc(signName)}${settings.phone ? `<br><span style="color:#6b7280;">${esc(settings.phone)}</span>` : ""}</p>
${emailFooterBlockHtml(b)}`);
}

/**
 * Best-effort: returns the error text (never throws). `to` = everyone the
 * invoice was sent to (invoiceRecipients), in one email.
 */
export async function sendReceiptEmail(
  b: InvoiceBundle,
  to: string[],
  p: { amount: number; paidOn: string; method: PaymentMethod; via: string; source: string },
  greet?: string
): Promise<string | null> {
  try {
    if (!to.length) return "No recipient.";
    const subject = receiptEmailSubject(b);
    const logId = newEmailLogId();
    const html = trackEmailHtml(receiptEmailHtml(b, p, greet), logId);
    let pdf: Uint8Array | null = null;
    try { pdf = await buildInvoicePdf(b); } catch { pdf = null; }
    const r = await postBillingEmail(b, { to: to.length === 1 ? to[0] : to, subject, html, pdf });
    await logEmail({
      id: logId,
      emailType: "billing_receipt",
      recipientEmail: to.join(", "),
      recipientRole: "client",
      subject,
      status: r.ok ? "sent" : "failed",
      error: r.message,
      sentBy: `billing_${p.source}`,
      listingId: b.invoice.listing_id,
      metadata: { invoiceId: b.invoice.id, number: b.invoice.number, brand: b.brand.key, ownerId: b.invoice.owner_id, amount: p.amount, method: p.method, pdf: !!pdf, recipients: to },
    });
    return r.message;
  } catch (e) {
    return e instanceof Error ? e.message : "Receipt failed.";
  }
}
