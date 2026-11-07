/**
 * The invoice email. Sent through Resend from the verified YachtPics sender
 * (hello@yachtpics.com) with the login's from-name; replies go to the login's
 * reply-to for that brand. The PDF is attached and the "View invoice" button
 * opens the public /inv page (which counts views). Logged in email_log and
 * tracked (opens / clicks) like the campaign emails.
 *
 * Due on receipt: the amount line says "Due on receipt" (or the due date if it
 * was set by hand). Below How to pay, the Notes + Terms & Conditions block
 * (invoiceFooter — same text as the PDF and /inv page), plain and small. A
 * test invoice says TEST INVOICE in the subject and a banner.
 */
import { logEmail } from "@/lib/logEmail";
import { newEmailLogId, trackEmailHtml } from "@/lib/emailTracking";
import { invoiceSubjectLine, pdfFileName, publicInvoiceUrl, PORTAL_ORIGIN, type InvoiceBundle } from "./invoices";
import { fmtDate, fmtMoney, invoiceFooter, splitPaymentLines } from "./types";

const SENDER = "hello@yachtpics.com";

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function invoiceEmailSubject(b: InvoiceBundle): string {
  const what = invoiceSubjectLine(b);
  if (b.invoice.is_test) return `TEST INVOICE from ${b.brand.display_name}${what ? ` — ${what}` : ""}`.replace(/\s+/g, " ").trim();
  return `Invoice ${b.invoice.number ?? ""} from ${b.brand.display_name}${what ? ` — ${what}` : ""}`.replace(/\s+/g, " ").trim();
}

export function invoiceEmailHtml(b: InvoiceBundle): string {
  const { invoice: inv, client, brand, settings } = b;
  const first = (client?.first_name || client?.display_name || "").split(" ")[0];
  const url = publicInvoiceUrl(inv.public_token);
  const what = inv.boat_name ? `for ${esc(inv.boat_name)}` : client?.company_name ? `for ${esc(client.company_name)}` : "";
  const logo = brand.logo_url ? (brand.logo_url.startsWith("/") ? PORTAL_ORIGIN + brand.logo_url : brand.logo_url) : null;
  const pay = settings.paymentInstructions
    ? `<div style="margin:28px 0 0;padding:16px 18px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;"><p style="margin:0 0 6px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;font-weight:600;">How to pay</p><p style="margin:0;font-size:14px;color:#111827;line-height:1.6;">${splitPaymentLines(settings.paymentInstructions).map(esc).join("<br>")}</p></div>`
    : "";
  const ft = invoiceFooter(brand, settings.paymentInstructions);
  const small = (label: string, rows: string[]) =>
    rows.length
      ? `<p style="margin:18px 0 4px;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;font-weight:600;">${esc(label)}</p><p style="margin:0;font-size:12px;color:#6b7280;line-height:1.55;">${rows.map(esc).join("<br>")}</p>`
      : "";
  const footer = ft.notes.length || ft.terms.length
    ? `<div style="margin:28px 0 0;padding-top:4px;border-top:1px solid #eceef1;">${small("Notes", ft.notes)}${small("Terms & Conditions", ft.terms)}</div>`
    : "";
  const dueLine = inv.due_date_manual && inv.due_date ? `Due ${esc(fmtDate(inv.due_date))}` : "Due on receipt";
  const testBanner = inv.is_test
    ? `<p style="margin:0 0 20px;padding:8px 12px;border:1px solid #fcd34d;background:#fffbeb;border-radius:6px;font-size:12px;font-weight:600;color:#92400e;letter-spacing:0.5px;">TEST INVOICE — not a real invoice</p>`
    : "";
  const fee = inv.card_fee_total
    ? `<p style="margin:10px 0 0;font-size:13px;color:#6b7280;">Includes a ${esc(fmtMoney(inv.card_fee_total))} card fee &mdash; please disregard it if paying by cash, check, Zelle or Venmo.</p>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:32px 16px;background:#f7f8f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #eceef1;border-radius:12px;padding:36px 36px 28px;">
${logo ? `<img src="${esc(logo)}" alt="${esc(brand.display_name)}" style="display:block;max-width:180px;max-height:46px;height:auto;margin:0 0 28px;">` : `<p style="margin:0 0 28px;font-size:18px;font-weight:600;color:#111827;">${esc(brand.display_name)}</p>`}
${testBanner}<p style="margin:0 0 14px;font-size:15px;color:#111827;line-height:1.6;">${first ? `Hi ${esc(first)},` : "Hello,"}</p>
<p style="margin:0 0 22px;font-size:15px;color:#374151;line-height:1.6;">Here is ${inv.is_test ? "a TEST invoice" : `invoice ${esc(inv.number)}`} ${what} from ${esc(brand.display_name)}.</p>
<p style="margin:0;font-size:13px;color:#6b7280;">Amount due</p>
<p style="margin:2px 0 0;font-size:26px;font-weight:300;color:#111827;">${esc(fmtMoney(inv.balance_due))}</p>
<p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${dueLine} &middot; Invoice date ${esc(fmtDate(inv.issue_date))}</p>
${fee}
<p style="margin:26px 0 0;"><a href="${esc(url)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">View invoice</a></p>
<p style="margin:12px 0 0;font-size:13px;color:#6b7280;">The PDF is attached.</p>
${pay}
<p style="margin:28px 0 0;font-size:14px;color:#374151;line-height:1.6;">Thank you,<br>${esc(settings.displayName)}${settings.phone ? `<br><span style="color:#6b7280;">${esc(settings.phone)}</span>` : ""}</p>
${footer}
</div>
<p style="max-width:560px;margin:14px auto 0;font-size:11px;color:#9ca3af;text-align:center;">${esc(brand.legal_name)}${brand.website ? ` · ${esc(brand.website)}` : ""}</p>
</body></html>`;
}

export async function sendInvoiceEmail(
  b: InvoiceBundle,
  pdf: Uint8Array,
  to: string,
  sentBy: string
): Promise<{ error: string | null }> {
  if (!process.env.RESEND_API_KEY) return { error: "Email isn't configured (RESEND_API_KEY)." };
  const subject = invoiceEmailSubject(b);
  const logId = newEmailLogId();
  const html = trackEmailHtml(invoiceEmailHtml(b), logId);
  const fromName = (b.settings.fromName || b.brand.display_name).replace(/["<>]/g, "");
  let ok = false;
  let message: string | null = null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${SENDER}>`,
        to,
        ...(b.settings.replyTo ? { reply_to: b.settings.replyTo } : {}),
        subject,
        html,
        attachments: [{ filename: pdfFileName(b.invoice, b.brand), content: Buffer.from(pdf).toString("base64") }],
      }),
    });
    const data: { message?: string } = await res.json().catch(() => ({}));
    ok = res.ok;
    message = ok ? null : data.message ?? `Email failed (${res.status}).`;
  } catch (e) {
    message = e instanceof Error ? e.message : "Email failed.";
  }
  await logEmail({
    id: logId,
    emailType: "billing_invoice",
    recipientEmail: to,
    recipientRole: "client",
    subject,
    status: ok ? "sent" : "failed",
    error: message,
    sentBy,
    listingId: b.invoice.listing_id,
    metadata: { invoiceId: b.invoice.id, number: b.invoice.number, brand: b.brand.key },
  });
  return { error: message };
}
