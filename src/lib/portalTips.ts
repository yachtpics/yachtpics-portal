// Weekly "tips & tricks" series. Each broker & assistant moves through these
// one per week (paced + approved), so existing users get a synchronized
// broadcast and new signups drip from where they join. Append new tips to the
// end of TIPS over time — order is the send order.

import { unsubscribeFooterHtml } from "@/lib/unsubscribe";

const PORTAL = "https://portal.yachtpics.com";

export type Tip = {
  /** Stable slug — also the email_log dedup key. Never change once sent. */
  slug: string;
  subject: string;
  headline: string;
  /** Body paragraphs (plain strings; wrapped in styled <p> automatically). */
  body: string[];
  ctaLabel: string;
  ctaPath: string;
};

/** email_log type + approval-setting key for a tip. */
export const tipEmailType = (slug: string) => `tip:${slug}`;
export const tipApprovalKey = (slug: string) => `tip_approved:${slug}`;

export const TIPS: Tip[] = [
  {
    slug: "publish-slideshow",
    subject: "Tip: the one step before you can send a listing",
    headline: "Publish, then share in seconds",
    body: [
      "Before you can send a listing to a client, publish its slideshow. Open the listing, find the Client Slideshow section, and click Create Slideshow — that turns your photos and video into a clean, full-screen gallery with its own link.",
      "Take a minute to set it up first: drag the photos into the order you want, hide any you'd rather not show, and tap the ★ on your best shot to make it the cover. That's the gallery — and the first impression — your buyer sees.",
      "Once it's published, Send to Client lights up: email it (branded, with documents), copy the link, or share the QR code. No publish, no link — so this is always step one.",
    ],
    ctaLabel: "Publish a slideshow",
    ctaPath: "/dashboard/listings",
  },
  {
    slug: "cover-photo",
    subject: "Tip: pick the photo that sells the boat",
    headline: "Lead with your best shot",
    body: [
      "Every flyer and social post starts with one hero image. Open a listing, tap the ★ on the photo you want front and center, and it becomes the cover everywhere — your spec sheet and your posts.",
      "Choose the shot that makes a buyer stop scrolling. It takes two seconds and changes how every listing presents.",
    ],
    ctaLabel: "Set a cover photo",
    ctaPath: "/dashboard/listings",
  },
  {
    slug: "spec-sheet",
    subject: "Tip: a branded flyer in one click",
    headline: "Turn any listing into a flyer",
    body: [
      "Open a listing and hit Spec Sheet. You get a clean, branded one-pager — full specs, your logo — ready to print or email a buyer.",
      "No design software, no waiting. It pulls straight from the details already on your listing.",
    ],
    ctaLabel: "Make a spec sheet",
    ctaPath: "/dashboard/listings",
  },
  {
    slug: "social-post",
    subject: "Tip: post-ready images, captions written for you",
    headline: "Social posts in seconds",
    body: [
      "From any listing, open Social Post. Pick a photo and you get a polished, branded image plus a caption and hashtags already written.",
      "Drop it straight onto Instagram or Facebook. The hard part — making it look professional — is already done.",
    ],
    ctaLabel: "Create a post",
    ctaPath: "/dashboard/listings",
  },
  {
    slug: "qr-code",
    subject: "Tip: let buyers scan straight to the boat",
    headline: "A QR code for every listing",
    body: [
      "Publish a listing's slideshow and it gets its own QR code. Add it to a flyer, a dock sign, or a printed brochure.",
      "A buyer scans with their phone and lands on your full gallery — no typing, no searching. Perfect for boat shows and at-the-dock showings.",
    ],
    ctaLabel: "Grab a QR code",
    ctaPath: "/dashboard/listings",
  },
  {
    slug: "view-alerts",
    subject: "Tip: know the moment a buyer looks",
    headline: "Perfect timing for a follow-up",
    body: [
      "When a buyer opens one of your slideshows, we email you. It's the best possible moment to reach out — while the boat is right on their mind.",
      "It's on by default. You can fine-tune it anytime in your profile.",
    ],
    ctaLabel: "Check your alerts",
    ctaPath: "/dashboard/profile",
  },
  {
    slug: "inquiries",
    subject: "Tip: capture leads right from the slideshow",
    headline: "Let interested buyers raise their hand",
    body: [
      "Your slideshow has a Request Info button. When a buyer fills it in, the lead lands in your inbox and on the listing — their name, contact, and message, ready to follow up.",
      "Every share becomes a chance to capture a real buyer, not just a view.",
    ],
    ctaLabel: "See your listings",
    ctaPath: "/dashboard/listings",
  },
  {
    slug: "walkthrough-video",
    subject: "Tip: add a walkthrough they can feel",
    headline: "Let buyers step aboard early",
    body: [
      "Upload an MP4 or MOV to any listing and it plays right inside your client slideshow — the closest thing to a sea trial before a buyer ever shows up.",
      "It's often what turns a maybe into a showing.",
    ],
    ctaLabel: "Add a video",
    ctaPath: "/dashboard/listings",
  },
  {
    slug: "send-to-client",
    subject: "Tip: a polished presentation in their inbox",
    headline: "Send to a client in one tap",
    body: [
      "Use Send to Client to deliver a branded email with your slideshow link and any documents attached. Your client gets a clean, professional presentation.",
      "And you get a record of every send, right on the listing — so you always know what went where.",
    ],
    ctaLabel: "Send a listing",
    ctaPath: "/dashboard/listings",
  },
];

export const TIP_BY_SLUG: Record<string, Tip> = Object.fromEntries(TIPS.map((t) => [t.slug, t]));

function para(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">${text}</p>`;
}

export function tipEmailHtml(
  tip: Tip,
  opts: { firstName: string; unsubToken?: string; notice?: string }
): string {
  const { firstName, unsubToken, notice } = opts;
  const unsubFooter = unsubToken ? unsubscribeFooterHtml(unsubToken) : "";
  const bodyHtml = tip.body.map(para).join("");
  const noticeHtml = notice
    ? `<div style="margin:0 0 24px;padding:14px 18px;background:#f8f3ea;border:1px solid #eaddc1;border-radius:8px;font-size:14px;color:#6b5a2a;line-height:1.6;">${notice}</div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      ${noticeHtml}
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#84662a;text-transform:uppercase;">Portal Tip</p>
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">${tip.headline}</h1>
      <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">Hi ${firstName},</p>
      ${bodyHtml}
      <div style="margin:28px 0 8px;">
        <a href="${PORTAL}${tip.ctaPath}" style="display:inline-block;background:#c39e4e;color:#050b14;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">${tip.ctaLabel}</a>
      </div>
      <p style="margin:24px 0 0;font-size:14px;color:#374151;line-height:1.6;">— Charlie &amp; Samantha<br><span style="color:#9ca3af;">YachtPics</span></p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0 0 6px;font-size:12px;color:#9ca3af;line-height:1.5;"><a href="${PORTAL}/dashboard/tips" style="color:#84662a;text-decoration:none;font-weight:600;">Browse all tips &rarr;</a></p>
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Professional yacht photography &amp; delivery<br>Questions? Just reply to this email.</p>
    </div>${unsubFooter}
  </div>
</body>
</html>`;
}
