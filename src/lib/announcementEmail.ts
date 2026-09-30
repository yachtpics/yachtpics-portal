// "What's new" announcement to existing brokers & assistants.
// Marketing-class email: it carries the unsubscribe footer and is sent only to
// recipients who haven't opted out. Styling mirrors the welcome/trial emails.
//
// This file always holds the CURRENT campaign. The previous one — the reel
// generator (`announcement_reel_2026_09`) — is in git history, and its type
// now lives in reelPromo.ts as REEL_ANNOUNCEMENT_TYPE for the reel follow-ups.

import { unsubscribeFooterHtml } from "@/lib/unsubscribe";

const SITE = "https://www.yachtpics.com";

/**
 * Stable type used for email_log dedup. Bump the suffix for the next campaign —
 * reusing a type would silently skip everyone who received the earlier one.
 */
export const ANNOUNCEMENT_TYPE = "announcement_website_2026_10";

/**
 * Subject: option A from broker-announcement-draft.md. Body: Version 1 (short).
 * No price, no pitch for the subscription. The pages are the gift; the contact
 * taps they produce are what make the subscription conversation easy later.
 */
export const ANNOUNCEMENT_SUBJECT = "Your listings now have a home on yachtpics.com";

/**
 * PROOF LINE — refresh before sending. GA4 → Reports → Engagement → Pages and
 * screens, last 7 days, most-viewed boat page. Never use a boat that has since
 * been marked as a pocket listing or taken off the site.
 * Last refreshed Sept 29 2026 (Sept 22–28): Agave, 53 views — the most-viewed
 * page on the whole site that week, homepage included.
 */
const PROOF_BOAT = "the 97′ Marlow Explorer <em>Agave</em>";
const PROOF_URL = `${SITE}/brokerage_boats/97_marlow_explorer_agave/`;
const PROOF_VIEWS = 53;

// Scheduled-send window (the Vercel cron fires daily at 13:00 UTC = 9am ET).
// The cron only sends inside this window; with the email_log dedup that
// guarantees a single send. Opens Friday Oct 2 (Charlie, Sept 30 — moved up
// from Oct 6; he's travelling, so it goes out on the cron, approved ahead).
// Manual "Send to all" on /admin/announce ignores the window.
export const ANNOUNCEMENT_SEND_AFTER = "2026-10-02T12:00:00Z";
export const ANNOUNCEMENT_SEND_BEFORE = "2026-10-14T13:00:00Z";

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
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#84662a;text-transform:uppercase;">New on yachtpics.com</p>
      <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;">Your listings now have a home on yachtpics.com</h1>

      ${p(`Hi ${firstName},`)}

      ${p(`Selected boats we photograph for you now get their own page on yachtpics.com: full gallery, key specs, and a direct line to you.`)}

      ${p(`There&rsquo;s nothing to set up and no cost. When buyers find your boat, they email you directly. We don&rsquo;t sit in the middle.`)}

      ${p(`The pages are already being found. Last week alone, one of them, <a href="${PROOF_URL}" style="color:#84662a;text-decoration:underline;">${PROOF_BOAT}</a>, was viewed ${PROOF_VIEWS} times.`)}

      <div style="margin:0 0 26px;padding:16px 20px;background:#f8f3ea;border:1px solid #eaddc1;border-radius:8px;">
        <p style="margin:0;font-size:14px;color:#6b5a2a;line-height:1.6;">If a boat should stay quiet, open the listing in the Portal and check <strong style="color:#4a3d17;">Keep this a pocket listing</strong>. It won&rsquo;t appear.</p>
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
