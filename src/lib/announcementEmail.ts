// "What's new" product announcement to existing brokers & assistants.
// Marketing-class email: it carries the unsubscribe footer and is sent only to
// recipients who haven't opted out. Styling mirrors the welcome/trial emails.

import { unsubscribeFooterHtml } from "@/lib/unsubscribe";

const PORTAL = "https://portal.yachtpics.com";

/** Stable type used for email_log dedup. Bump the suffix for the next campaign. */
export const ANNOUNCEMENT_TYPE = "announcement_2026_summer";
export const ANNOUNCEMENT_SUBJECT = "New in your Portal — turn every listing into marketing, in minutes";

// Scheduled-send window (the Vercel cron fires Monday 9am ET = 13:00 UTC, June
// being EDT/UTC-4). The cron only sends inside this window; combined with the
// email_log dedup, that guarantees a single send on the intended Monday.
export const ANNOUNCEMENT_SEND_AFTER = "2026-06-22T13:00:00Z";
export const ANNOUNCEMENT_SEND_BEFORE = "2026-06-25T13:00:00Z";

function feature(title: string, body: string): string {
  return `<tr>
      <td style="width:16px;vertical-align:top;padding:9px 0 0;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#c39e4e;"></span></td>
      <td style="padding:6px 0;font-size:14px;color:#374151;line-height:1.55;"><strong style="color:#111827;">${title}</strong> — ${body}</td>
    </tr>`;
}

export function announcementHtml(opts: { firstName: string; unsubToken?: string }): string {
  const { firstName, unsubToken } = opts;
  const unsubFooter = unsubToken ? unsubscribeFooterHtml(unsubToken) : "";

  const features = [
    feature(
      "One-click spec sheet",
      "generate a clean, branded flyer for any listing — full specs and your logo — ready to print or email."
    ),
    feature(
      "Social posts, done for you",
      "turn any photo into a polished, post-ready image with a caption and hashtags already written. Drop it straight onto Instagram or Facebook."
    ),
    feature(
      "QR codes for your listings",
      "publish a slideshow and the listing gets its own QR code. Add it to a flyer or a dock sign and a buyer scans straight to the full gallery."
    ),
    feature(
      "Know the moment they look",
      "we email you the instant a buyer opens your slideshow — so you can follow up while you&rsquo;re right on their mind."
    ),
    feature(
      "Buyer inquiries come to you",
      "buyers can request more info right from your slideshow — every lead lands in your inbox and on the listing, ready to follow up."
    ),
  ].join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;">We&rsquo;ve been busy behind the scenes, ${firstName}</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">The Portal started as the home for every shoot we deliver. Over the last few weeks we&rsquo;ve added a set of tools that take your photos further — helping you market each listing and turn interest into conversations. Here&rsquo;s what&rsquo;s new:</p>

      <table style="width:100%;border-collapse:collapse;margin:0 0 22px;">${features}</table>

      <p style="margin:0 0 26px;font-size:14px;color:#6b7280;line-height:1.6;">Two more touches: you can now pick the <strong style="color:#374151;">cover photo</strong> that leads your flyer and posts, and <strong style="color:#374151;">search</strong> your listings instantly as you type.</p>

      <div style="margin:0 0 28px;">
        <a href="${PORTAL}/dashboard" style="display:inline-block;background:#c39e4e;color:#050b14;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">See what&rsquo;s new</a>
      </div>

      <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">Open any listing and you&rsquo;ll find these waiting. As always, your delivered photos stay free to download — and if you have a question or an idea for what we should build next, just reply to this email. We read every one.</p>

      <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">— Charlie &amp; Samantha<br><span style="color:#9ca3af;">YachtPics</span></p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Professional yacht photography &amp; delivery<br>Questions? Just reply to this email.</p>
    </div>${unsubFooter}
  </div>
</body>
</html>`;
}
