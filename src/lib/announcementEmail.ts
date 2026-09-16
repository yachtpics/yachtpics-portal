// "What's new" product announcement to existing brokers & assistants.
// Marketing-class email: it carries the unsubscribe footer and is sent only to
// recipients who haven't opted out. Styling mirrors the welcome/trial emails.

import { unsubscribeFooterHtml } from "@/lib/unsubscribe";
import { reelPromoEndsOn } from "@/lib/reelPromo";

const PORTAL = "https://portal.yachtpics.com";

// No price and no competitor comparison in this email, on purpose. It is an
// open house: the offer is the message, and a fee schedule sitting next to a
// free gift only invites the reader to price the gift. Most of this list is
// mid-trial anyway and will meet the price on its own soon enough.

/**
 * Stable type used for email_log dedup. Bump the suffix for the next campaign —
 * the previous one was `announcement_portal_story` (Aug 2026), and reusing a
 * type would silently skip everyone who received it.
 */
export const ANNOUNCEMENT_TYPE = "announcement_reel_2026_09";

/**
 * WHAT THE "FIRST" CLAIM RESTS ON (researched Sept 2026, before this went out):
 *   - YachtWorld / Boats Group ship an AI Listing Builder that writes listing
 *     TEXT from vessel data. No video.
 *   - YATCO's BOSS has a digital asset manager: it stores photos and video and
 *     publishes them to social. It does not generate anything.
 *   - YachtCloser is contracts. YachtPushr writes articles and posts from
 *     inventory; no evidence of video.
 *   Caveat: BOSS and BoatWizard sit behind logins, so that reading comes from
 *   their own marketing, which consistently describes storing and publishing
 *   media and never generating it. Strongly evidenced, not proven from inside.
 *
 *   Photo-to-reel DOES exist in real estate (HDPhotoHub is the closest
 *   structural parallel — a media-delivery platform that auto-generates
 *   branded vertical reels because it already holds the photos and the brand).
 *   So the claim is scoped to yacht MLS and brokerage platforms, never
 *   "nobody anywhere" — a broker who has seen the real-estate tools would
 *   catch that, and one caught overclaim costs more than the line earns.
 *
 * The subject leads on being first, and names the CLOSING DATE rather than a
 * duration. "The first" rather than "the only": we can stand behind having got
 * there first without claiming to have audited every platform on earth.
 *
 * "Free for two weeks" is only true on the day it's written. This email waited
 * a week for the Stack look, and a duration in the subject quietly becomes a
 * lie every day it sits unsent. The date is read from reelPromo, so the
 * subject, the body and the banner on the Reel page can never disagree — move
 * REEL_PROMO_END and all three follow.
 */
export const ANNOUNCEMENT_SUBJECT = `The first reel generator in yachting — free until ${reelPromoEndsOn()}`;

// Scheduled-send window (the Vercel cron fires Monday 9am ET = 13:00 UTC). The
// cron only sends inside this window; combined with the email_log dedup, that
// guarantees a single send. Manual "Send to all" from the admin page works too,
// which is how this one is meant to go out.
//
// SEND_BEFORE deliberately closes well before the promo does. An announcement
// that lands with three days left on the offer is worse than one that waits:
// if this window has passed, the right move is to push REEL_PROMO_END out and
// move this with it, not to send into the tail end of the fortnight.
export const ANNOUNCEMENT_SEND_AFTER = "2026-09-09T12:00:00Z";
export const ANNOUNCEMENT_SEND_BEFORE = "2026-09-23T13:00:00Z";

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
      <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;">The first reel generator in yachting</h1>

      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Hi ${firstName},</p>

      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Open any listing and you&rsquo;ll find a new button: <strong style="color:#111827;">Reel</strong>. Press it and the photographs you already have &mdash; your order, your cover shot first &mdash; come back as a finished video in under a minute. Around forty seconds, the length the feed actually rewards.</p>

      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">No yacht MLS or brokerage platform does this. They will store your photographs, and one or two will now write your listing copy &mdash; none of them will turn the photographs into video. We built it because putting a boat on Instagram shouldn&rsquo;t mean hiring an editor.</p>

      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Six looks, from a restrained brochure register to a fast hard-cut edit built for center consoles. Your own brand colours &mdash; and if you&rsquo;ve uploaded your logo to the Portal, press <strong style="color:#111827;">Match my logo</strong> and it reads the colour straight off the mark. Vertical for Instagram and Facebook, or widescreen to send a buyer and add to the listing.</p>

      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">When it&rsquo;s done, press <strong style="color:#111827;">Send to my phone</strong>. A code appears on screen, you point your phone at it, and the reel is in your camera roll &mdash; ready to post with whatever audio you like.</p>

      <div style="margin:0 0 26px;padding:18px 20px;background:#f8f3ea;border:1px solid #eaddc1;border-radius:8px;">
        <p style="margin:0 0 6px;font-size:15px;color:#6b5a2a;line-height:1.6;"><strong style="color:#4a3d17;">Open to every account until ${closes}.</strong></p>
        <p style="margin:0 0 6px;font-size:14px;color:#6b5a2a;line-height:1.6;">Subscribed, on trial, or long lapsed &mdash; until then make as many as you like, on any listing, and download them clean.</p>
        <p style="margin:0;font-size:14px;color:#6b5a2a;line-height:1.6;"><strong style="color:#4a3d17;">Anything you make is yours to keep.</strong> Whatever you decide after ${closes}, the reels stay yours &mdash; to post, to re-post, to keep using.</p>
      </div>

      <p style="margin:0 0 14px;font-size:15px;color:#374151;line-height:1.6;">While you&rsquo;re in there, three others worth a look:</p>

      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 26px;">
        ${bullet("The caption, written for you.", "Write with AI reads the frames you picked &mdash; the actual photographs, in order &mdash; and writes a headline and caption with hashtags. Yours to edit before anything goes out.")}
        ${bullet("What buyers actually look at.", "Every listing has an Engagement panel: who opened it, how long they stayed, and which photographs they lingered on and saved.")}
        ${bullet("A report for the owner.", "One branded page you can print or send &mdash; the answer to &ldquo;what are you doing for my boat?&rdquo; before they ask.")}
      </table>

      <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">One thing that hasn&rsquo;t changed, and won&rsquo;t: <strong style="color:#374151;">your photographs are always free to download.</strong> That was the whole point on day one, and it still is.</p>

      <div style="margin:26px 0;">
        <a href="${PORTAL}/dashboard/listings" style="display:inline-block;background:#c39e4e;color:#050b14;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">Make a reel</a>
      </div>

      <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">Make one for your best boat and see what it does. If it&rsquo;s good, send it to us &mdash; we&rsquo;d like to see it.</p>

      <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">— Charlie &amp; Samantha<br><span style="color:#9ca3af;">YachtPics</span></p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Professional yacht photography &amp; delivery<br>Questions? Just reply to this email.</p>
    </div>${unsubFooter}
  </div>
</body>
</html>`;
}
