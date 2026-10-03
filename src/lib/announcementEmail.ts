// "What's new" announcement to existing brokers & assistants.
// Marketing-class email: it carries the unsubscribe footer and is sent only to
// recipients who haven't opted out. Styling mirrors the welcome/trial emails.
//
// This file always holds the CURRENT campaign. The previous ones — the reel
// generator (`announcement_reel_2026_09`) and the yachtpics.com listing pages
// (`announcement_website_2026_10`, sent to all 150 on Oct 2) — are in git
// history. The reel one's type lives in reelPromo.ts as REEL_ANNOUNCEMENT_TYPE
// for the reel follow-ups.

import { unsubscribeFooterHtml } from "@/lib/unsubscribe";

/**
 * Stable type used for email_log dedup. Bump the suffix for the next campaign —
 * reusing a type would silently skip everyone who received the earlier one.
 * A new type also starts UNAPPROVED: the scheduled send waits for Approve on
 * /admin/announce (app_settings `${ANNOUNCEMENT_TYPE}_approved`).
 */
export const ANNOUNCEMENT_TYPE = "announcement_walkthrough_2026_10";

/**
 * The depth looks, Walkthrough and Underway, opening to every broker on Fri
 * Oct 9 2026 at 9:00 AM ET (DEPTH_LOOKS_OPEN_AT in depthLooksRelease.ts).
 * No price, no competitor, no "first"/"only".
 */
export const ANNOUNCEMENT_SUBJECT = "Your listing photos now move like you\u2019re aboard";

// Scheduled-send window. The Vercel cron calls the announce job once a day,
// around 13:00–13:35 UTC (9am ET); it only sends inside this window, and with
// the email_log dedup that means a single send. The window opens at the same
// instant the looks unlock (13:00 UTC Fri Oct 9), never before it, so the
// first run that can send is Friday morning's — provided the campaign has been
// approved on /admin/announce. If it hasn't been approved by the Friday run,
// it goes out on the first daily run after approval, up to Fri Oct 16.
// Manual "Send to all" on /admin/announce ignores the window — before Oct 9
// 9am ET that would announce looks brokers can't open yet.
export const ANNOUNCEMENT_SEND_AFTER = "2026-10-09T13:00:00Z";
export const ANNOUNCEMENT_SEND_BEFORE = "2026-10-16T13:00:00Z";

export function announcementHtml(opts: { firstName: string; unsubToken?: string }): string {
  const { firstName, unsubToken } = opts;
  const unsubFooter = unsubToken ? unsubscribeFooterHtml(unsubToken) : "";
  const p = (html: string) =>
    `<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">${html}</p>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics</p>
    </div>
    <div style="padding:40px;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#84662a;text-transform:uppercase;">New in the Portal</p>
      <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;">Your listing photos, now a walkthrough</h1>

      ${p(`Hi ${firstName},`)}

      ${p(`Two new looks in the reel maker turn the photos you already have into a walkthrough. The camera moves through each photograph, so the foreground passes and the room opens up, the way it does when you step aboard.`)}

      ${p(`<strong>Walkthrough</strong> is the quiet one, made for the listing film. <strong>Underway</strong> adds wipes and dips between spaces, made for social.`)}

      ${p(`Every frame is the real boat. Nothing is generated and nothing is filled in, so what a buyer sees is what is there.`)}

      <div style="margin:0 0 26px;padding:16px 20px;background:#f8f3ea;border:1px solid #eaddc1;border-radius:8px;">
        <p style="margin:0;font-size:14px;color:#6b5a2a;line-height:1.6;">To try it, open a listing in the Portal, choose <strong style="color:#4a3d17;">Reel</strong>, and pick <strong style="color:#4a3d17;">Walkthrough</strong> or <strong style="color:#4a3d17;">Underway</strong>. Allow a couple of minutes: it reads the depth of each photograph before it renders.</p>
      </div>

      <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">Charlie Clark<br><span style="color:#9ca3af;">YachtPics</span></p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Professional yacht photography &amp; delivery<br>Questions? Just reply to this email.</p>
    </div>${unsubFooter}
  </div>
</body>
</html>`;
}
