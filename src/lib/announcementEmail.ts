// "What's new" product announcement to existing brokers & assistants.
// Marketing-class email: it carries the unsubscribe footer and is sent only to
// recipients who haven't opted out. Styling mirrors the welcome/trial emails.

import { unsubscribeFooterHtml } from "@/lib/unsubscribe";

const PORTAL = "https://portal.yachtpics.com";

/** Stable type used for email_log dedup. Bump the suffix for the next campaign. */
export const ANNOUNCEMENT_TYPE = "announcement_portal_story";
export const ANNOUNCEMENT_SUBJECT = "It started as a link to your photos";

// Scheduled-send window (the Vercel cron fires Monday 9am ET = 13:00 UTC). The
// cron only sends inside this window; combined with the email_log dedup, that
// guarantees a single send. Manual "Send to all" from the admin page works too.
export const ANNOUNCEMENT_SEND_AFTER = "2026-08-10T13:00:00Z";
export const ANNOUNCEMENT_SEND_BEFORE = "2026-09-01T13:00:00Z";

export function announcementHtml(opts: { firstName: string; unsubToken?: string }): string {
  const { firstName, unsubToken } = opts;
  const unsubFooter = unsubToken ? unsubscribeFooterHtml(unsubToken) : "";

  const bullet = (strong: string, rest: string) =>
    `<tr>
      <td style="padding:0 10px 12px 0;vertical-align:top;color:#c39e4e;font-size:15px;line-height:1.6;">&mdash;</td>
      <td style="padding:0 0 12px;font-size:15px;color:#374151;line-height:1.6;"><strong style="color:#111827;">${strong}</strong> ${rest}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#84662a;text-transform:uppercase;">Where we are now</p>
      <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;">It started as a link to your photos</h1>

      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Hi ${firstName},</p>

      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">What you needed was always simple: a way to put the photos in front of the person who needed to see them.</p>

      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">That&rsquo;s the whole reason yachtpics.com exists. It began as a place to keep a slideshow link for every boat we shot &mdash; so you could send one link to a client and they could look at the boat from wherever they were. Back before internet speeds caught up, that was no small thing.</p>

      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">The Portal is that same idea, grown up. Send a client a link to the boat &mdash; then keep going, because once your photos live somewhere proper, a lot of the work you&rsquo;d otherwise do by hand stops needing to be done at all. Here&rsquo;s what&rsquo;s waiting in there now:</p>

      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 26px;">
        ${bullet("Every shoot, permanently.", "Photos and walkthrough video in one place. Nothing expires, nothing to hunt for.")}
        ${bullet("A branded slideshow", "you can send to a client in one tap &mdash; with documents attached.")}
        ${bullet("A spec sheet flyer", "in one click, using your cover photo.")}
        ${bullet("Post-ready social graphics", "with the captions already written.")}
        ${bullet("A QR code", "for the boat show &mdash; buyers scan straight to the boat.")}
        ${bullet("Buyer inquiries", "captured right off the slideshow and sent to you.")}
        ${bullet("An alert", "the moment someone opens your listing.")}
        ${bullet("Your assistant, co-broker and office", "all working from the same set of photos.")}
      </table>

      <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">Same shoot. Same photos. The difference is that everything you&rsquo;d normally rebuild by hand &mdash; the flyer, the post, the presentation &mdash; is already sitting there, made from the images we took.</p>

      <div style="margin:26px 0;">
        <a href="${PORTAL}/dashboard/listings" style="display:inline-block;background:#c39e4e;color:#050b14;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">Open your Portal</a>
      </div>

      <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">And the part that hasn&rsquo;t changed, and won&rsquo;t: <strong style="color:#374151;">your photos are always free to download.</strong> That was the whole point on day one, and it still is.</p>

      <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">If there&rsquo;s something you still do by hand that the Portal ought to be doing for you, tell us. We&rsquo;d rather build it than have you work around it.</p>

      <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">— Charlie &amp; Samantha<br><span style="color:#9ca3af;">YachtPics</span></p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Professional yacht photography &amp; delivery<br>Questions? Just reply to this email.</p>
    </div>${unsubFooter}
  </div>
</body>
</html>`;
}
