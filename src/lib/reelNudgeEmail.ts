// Reel nudge for the media-delivery emails (notify-broker, notify-assistant).
// The delivery email is the highest-intent moment in the funnel — the broker is
// about to post the boat — so this is where the reel gets mentioned every time,
// not just in a one-off announcement.
//
// TODO (policy decided Sept 19, not yet built): once "two reels included with
// every shoot" ships, replace the promo line with "Two reels are included with
// this shoot." and drop the promo import.
import { reelPromoActive, reelPromoEndsOn } from "@/lib/reelPromo";

const PORTAL = "https://portal.yachtpics.com";

export function reelNudgeHtml(opts: { listingId: string; now?: Date }): string {
  const promo = reelPromoActive(opts.now);
  const tail = promo
    ? ` Free to every account until ${reelPromoEndsOn()}.`
    : "";
  return `<div style="margin:28px 0 0;padding:18px 20px;background:#f8f3ea;border:1px solid #eaddc1;border-radius:8px;">
  <p style="margin:0 0 6px;font-size:15px;font-weight:600;color:#4a3d17;line-height:1.5;">Your first reel is one press away.</p>
  <p style="margin:0 0 10px;font-size:14px;color:#6b5a2a;line-height:1.6;">Open the listing and press <strong style="color:#4a3d17;">Reel</strong>. The photographs you just received come back as a finished forty-second video &mdash; vertical for Instagram, widescreen for a buyer.${tail}</p>
  <a href="${PORTAL}/dashboard/listings/${opts.listingId}/reel" style="font-size:14px;font-weight:600;color:#84662a;text-decoration:none;">Make a reel &rarr;</a>
</div>`;
}
