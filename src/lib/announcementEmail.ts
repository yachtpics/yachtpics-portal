// "What's new" product announcement to existing brokers & assistants.
// Marketing-class email: it carries the unsubscribe footer and is sent only to
// recipients who haven't opted out. Styling mirrors the welcome/trial emails.

import { unsubscribeFooterHtml } from "@/lib/unsubscribe";

const PORTAL = "https://portal.yachtpics.com";

/** Stable type used for email_log dedup. Bump the suffix for the next campaign. */
export const ANNOUNCEMENT_TYPE = "announcement_recently_photographed";
export const ANNOUNCEMENT_SUBJECT = "New: see what we've been shooting";

// Scheduled-send window (the Vercel cron fires Monday 9am ET = 13:00 UTC). The
// cron only sends inside this window; combined with the email_log dedup, that
// guarantees a single send. Manual "Send to all" from the admin page works too.
export const ANNOUNCEMENT_SEND_AFTER = "2026-07-13T13:00:00Z";
export const ANNOUNCEMENT_SEND_BEFORE = "2026-08-04T13:00:00Z";

export function announcementHtml(opts: { firstName: string; unsubToken?: string }): string {
  const { firstName, unsubToken } = opts;
  const unsubFooter = unsubToken ? unsubscribeFooterHtml(unsubToken) : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#84662a;text-transform:uppercase;">New in the Portal</p>
      <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;">See what we&rsquo;ve been shooting, ${firstName}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">There&rsquo;s a new page in your Portal: <strong style="color:#111827;">Recently Photographed</strong> — a running showcase of the latest boats through the YachtPics lens.</p>

      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">It&rsquo;s built for one thing: helping you connect. Have a client looking for a certain kind of boat? Browse the newest shoots and reach the listing broker directly — their name, phone, and email are right on the card. No prices, no clutter, just fresh inventory and a warm handoff between brokers.</p>

      <div style="margin:26px 0;">
        <a href="${PORTAL}/dashboard/showcase" style="display:inline-block;background:#c39e4e;color:#050b14;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">See Recently Photographed</a>
      </div>

      <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">Keeping a boat quiet? You&rsquo;re always in control. Open the listing and check <strong style="color:#374151;">&ldquo;Keep this a pocket listing&rdquo;</strong> to hide it from the showcase — nothing else about your listing changes.</p>

      <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">We&rsquo;ll keep featuring new work as it&rsquo;s delivered. If a boat of yours belongs here, odds are you&rsquo;ll see it soon. Questions or ideas? Just reply — we read every one.</p>

      <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">— Charlie &amp; Samantha<br><span style="color:#9ca3af;">YachtPics</span></p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Professional yacht photography &amp; delivery<br>Questions? Just reply to this email.</p>
    </div>${unsubFooter}
  </div>
</body>
</html>`;
}
