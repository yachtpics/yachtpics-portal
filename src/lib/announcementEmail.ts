// "What's new" product announcement to existing brokers & assistants.
// Marketing-class email: it carries the unsubscribe footer and is sent only to
// recipients who haven't opted out. Styling mirrors the welcome/trial emails.

import { unsubscribeFooterHtml } from "@/lib/unsubscribe";
import { reelPromoEndsOn } from "@/lib/reelPromo";

const PORTAL = "https://portal.yachtpics.com";

/**
 * Stable type used for email_log dedup. Bump the suffix for the next campaign —
 * the previous one was `announcement_portal_story` (Aug 2026), and reusing a
 * type would silently skip everyone who received it.
 */
export const ANNOUNCEMENT_TYPE = "announcement_reel_2026_09";
export const ANNOUNCEMENT_SUBJECT = "Your photos are now a reel — free for two weeks";

// Scheduled-send window (the Vercel cron fires Monday 9am ET = 13:00 UTC). The
// cron only sends inside this window; combined with the email_log dedup, that
// guarantees a single send. Manual "Send to all" from the admin page works too,
// which is how this one is meant to go out — the fortnight starts when it lands.
export const ANNOUNCEMENT_SEND_AFTER = "2026-09-09T12:00:00Z";
export const ANNOUNCEMENT_SEND_BEFORE = "2026-09-20T13:00:00Z";

export function announcementHtml(opts: { firstName: string; unsubToken?: string }): string {
  const { firstName, unsubToken } = opts;
  const unsubFooter = unsubToken ? unsubscribeFooterHtml(unsubToken) : "";
  const closes = reelPromoEndsOn();

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
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#84662a;text-transform:uppercase;">New in the Portal</p>
      <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;">Your photographs, as a reel</h1>

      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Hi ${firstName},</p>

      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Open any listing and you&rsquo;ll find a new button: <strong style="color:#111827;">Reel</strong>. Click it and the photographs you already have &mdash; in the order you&rsquo;ve set them, your cover shot first &mdash; come back as a finished video. About twenty seconds, ready to post.</p>

      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Not a slideshow with a logo on the front. You choose the look &mdash; four of them, from the restrained brochure register to a slow letterboxed cut &mdash; and it renders right there in your browser in under a minute. Vertical for Instagram and Facebook, or widescreen to send a buyer and add straight to the listing.</p>

      <div style="margin:0 0 26px;padding:18px 20px;background:#f8f3ea;border:1px solid #eaddc1;border-radius:8px;">
        <p style="margin:0 0 6px;font-size:15px;color:#6b5a2a;line-height:1.6;"><strong style="color:#4a3d17;">It&rsquo;s open to everyone until ${closes}.</strong></p>
        <p style="margin:0;font-size:14px;color:#6b5a2a;line-height:1.6;">Subscribed, on trial, or lapsed &mdash; for the next two weeks every account can make as many reels as they like, on any listing, and download them clean. Make one for your best boat and see what it does.</p>
      </div>

      <p style="margin:0 0 14px;font-size:15px;color:#374151;line-height:1.6;">And a few other things worth knowing about:</p>

      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 26px;">
        ${bullet("The caption, written for you.", "On the Reel page, Write with AI reads the photographs you picked &mdash; the actual frames, in order &mdash; and writes a headline and a caption with hashtags. Yours to edit before anything goes out.")}
        ${bullet("What buyers actually look at.", "Every listing now has an Engagement panel: who opened it, how long they stayed, and which photographs they lingered on and saved.")}
        ${bullet("A report for the owner.", "One branded page you can print or send &mdash; the answer to &ldquo;what are you doing for my boat?&rdquo; before they ask.")}
        ${bullet("Names on your sends.", "Add the client&rsquo;s name in Send to Client and the alert tells you who opened it, and how many times.")}
        ${bullet("Photos labelled on arrival.", "Uploads the file name can&rsquo;t place get sorted into the walk-through order for you.")}
        ${bullet("360&deg; tours and deck plans.", "Paste a tour link and upload the general arrangement &mdash; both show up on your client slideshow.")}
      </table>

      <div style="margin:26px 0;">
        <a href="${PORTAL}/dashboard/listings" style="display:inline-block;background:#c39e4e;color:#050b14;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">Make a reel</a>
      </div>

      <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">One thing that hasn&rsquo;t changed, and won&rsquo;t: <strong style="color:#374151;">your photos are always free to download.</strong> That was the whole point on day one, and it still is.</p>

      <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">If you make something good with it, send it to us &mdash; we&rsquo;d like to see it. And if there&rsquo;s something you still do by hand that the Portal ought to be doing for you, tell us. We&rsquo;d rather build it than have you work around it.</p>

      <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">— Charlie &amp; Samantha<br><span style="color:#9ca3af;">YachtPics</span></p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Professional yacht photography &amp; delivery<br>Questions? Just reply to this email.</p>
    </div>${unsubFooter}
  </div>
</body>
</html>`;
}
