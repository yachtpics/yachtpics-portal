// The free-trial email sequence (owner decision, Oct 24 2026). Three emails,
// sent by /api/cron/trial-reminders (daily, 9am ET) at offsets from each
// broker's own trial — 14 days for accounts opened from Oct 24 2026, 30 for
// accounts opened before (trialDaysFor in subscriptionAccess.ts):
//
//   trial_day7    day 7          their own Seller Report numbers for the week
//   trial_ending  2 days left    what stops, what stays, one button to Billing
//   trial_ended   first run after the trial ends — photos still free, Starter $29
//
// Style follows the other broker emails: ink header, brass accent, short,
// understated, no exclamation marks, no emoji.

import { PLAN_BENEFITS, PLAN_ONE_LINER, PLAN_PUTS_TO_WORK } from "@/lib/planValue";
import { unsubscribeFooterHtml } from "@/lib/unsubscribe";

const PORTAL = "https://portal.yachtpics.com";

/** email_log types — one per email, so each dedups on its own. */
export const TRIAL_EMAIL_TYPE = {
  day7: "trial_day7",
  ending: "trial_ending",
  ended: "trial_ended",
} as const;

/** Types the earlier (pre-Oct 24) reminders logged; counted as already sent. */
export const LEGACY_TRIAL_EMAIL_TYPE = {
  ending: "trial_expiring",
  ended: "trial_lapsed",
} as const;

/** The Starter plan price quoted in the ended email (src/lib/plans.ts). */
const STARTER_PRICE = 29;

export type TrialEmail = { subject: string; html: string };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shell(inner: string, unsubToken?: string): string {
  const unsubFooter = unsubToken ? unsubscribeFooterHtml(unsubToken) : "";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
    </div>
    <div style="padding:40px;">${inner}</div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Professional yacht photography &amp; delivery<br>Questions? Just reply to this email.</p>
    </div>${unsubFooter}
  </div>
</body>
</html>`;
}

const kicker = (t: string) =>
  `<p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#84662a;text-transform:uppercase;">${t}</p>`;
const h1 = (t: string) => `<h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;">${t}</h1>`;
const p = (html: string, muted = false) =>
  `<p style="margin:0 0 18px;font-size:15px;color:${muted ? "#6b7280" : "#374151"};line-height:1.6;">${html}</p>`;
const cta = (label: string, href: string) =>
  `<div style="margin:26px 0;">
    <a href="${href}" style="display:inline-block;background:#c39e4e;color:#050b14;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">${label}</a>
  </div>`;
const signoff = `<p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">&mdash; Charlie &amp; Samantha<br><span style="color:#9ca3af;">YachtPics</span></p>`;

function list(items: string[]): string {
  const rows = items
    .map(
      (t) => `<tr>
    <td style="padding:0 10px 10px 0;vertical-align:top;color:#c39e4e;font-size:15px;line-height:1.6;">&mdash;</td>
    <td style="padding:0 0 10px;font-size:15px;color:#374151;line-height:1.6;">${t}</td>
  </tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px;">${rows}</table>`;
}

const label = (t: string) =>
  `<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;">${t}</p>`;

// What the trial gives that stops at the end, and what stays — the
// canonical plan benefits (src/lib/planValue.ts), in the same order, checked
// against the code: slideshows go private and Send to Client is refused
// (publicSlideshow.ts, send-to-client route), Seller Reports lock (report
// page), reels fall back to two per listing (reelAllowance.ts), dock-card
// QR codes lead to the now-private slideshow, uploads of your own photos
// stop (listing page); photo downloads stay free.
const strong = (t: string) => `<strong style="color:#111827;">${t}.</strong>`;
const BENEFIT = Object.fromEntries(PLAN_BENEFITS.map((b) => [b.key, b.label])) as Record<string, string>;
const STOPS = [
  `${strong(BENEFIT.slideshows)} The links go private and Send to Client stops.`,
  `${strong(BENEFIT.reports)} They lock.`,
  `${strong(BENEFIT.reels)} Back to two per listing.`,
  `${strong(BENEFIT.dockcards)} Their QR codes lead to a private slideshow.`,
  `${strong(BENEFIT.own)} Uploading your own photos stops.`,
];
// The same five, as they stand once the trial has ended.
const STOPPED = [
  `${strong(BENEFIT.slideshows)} The links are private and Send to Client is off.`,
  `${strong(BENEFIT.reports)} Locked.`,
  `${strong(BENEFIT.reels)} Back to two per listing.`,
  `${strong(BENEFIT.dockcards)} Their QR codes lead to a private slideshow.`,
  `${strong(BENEFIT.own)} Uploads of your own photos are off.`,
];
const STAYS = [
  "<strong style=\"color:#111827;\">Every photograph we delivered</strong>, free to download, always.",
  "<strong style=\"color:#111827;\">Two reels per listing.</strong>",
];

// ── Day 7 ─────────────────────────────────────────────────────────────────

export type WeekRow = {
  listingId: string;
  vesselName: string | null;
  views: number;
  uniqueVisitors: number;
  photoLooks: number;
  sends: number;
};

/**
 * Day 7: the broker's own Seller Report numbers for the last seven days, one
 * row per listing (max 5, busiest first). With no activity: no slideshow
 * published → "publish a slideshow"; published but unopened → "send it to one
 * buyer".
 */
export function trialDay7Email(opts: {
  firstName: string;
  endsOn: string; // e.g. "Friday, November 7"
  rows: WeekRow[]; // published listings, busiest first
  firstListingId: string | null; // most recently updated listing, if any
  unsubToken?: string;
}): TrialEmail {
  const { firstName, endsOn, firstListingId, unsubToken } = opts;
  const rows = opts.rows.slice(0, 5);
  const active = rows.filter((r) => r.views + r.uniqueVisitors + r.photoLooks + r.sends > 0);

  if (active.length > 0) {
    const th = (t: string, left = false) =>
      `<th style="padding:8px 6px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;text-align:${left ? "left" : "right"};border-bottom:1px solid #e5e7eb;">${t}</th>`;
    const td = (t: string | number, left = false) =>
      `<td style="padding:10px 6px;font-size:14px;color:#374151;text-align:${left ? "left" : "right"};border-bottom:1px solid #f3f4f6;font-variant-numeric:tabular-nums;">${t}</td>`;
    const body = active
      .map(
        (r) => `<tr>
        ${td(`<a href="${PORTAL}/report/listing/${r.listingId}" style="color:#84662a;font-weight:600;text-decoration:none;">${esc(r.vesselName ?? "Untitled vessel")}</a>`, true)}
        ${td(r.views)}${td(r.uniqueVisitors)}${td(r.photoLooks)}${td(r.sends)}
      </tr>`
      )
      .join("");
    const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 10px;">
      <tr>${th("Listing", true)}${th("Views")}${th("Visitors")}${th("Photo looks")}${th("Sent")}</tr>
      ${body}
    </table>`;
    const inner = `
      ${kicker("One week in")}
      ${h1("Here&rsquo;s what your listings did this week")}
      ${p(`Hi ${esc(firstName)},`)}
      ${p("This is your Seller Report in short &mdash; what buyers did with your listings over the last seven days.")}
      ${table}
      ${p("Views are slideshow opens, visitors are different people, photo looks are photographs a buyer stopped on, and sent is how many times you sent it to a client.", true)}
      ${p("Each name opens that listing&rsquo;s full Seller Report &mdash; one page, ready to forward to the owner.")}
      ${cta("Open the Seller Report", `${PORTAL}/report/listing/${active[0].listingId}`)}
      ${p(`Your free trial runs until ${esc(endsOn)}.`, true)}
      ${signoff}`;
    return { subject: "Here's what your listings did this week", html: shell(inner, unsubToken) };
  }

  const published = rows.length > 0;
  const target = published
    ? `${PORTAL}/dashboard/listings/${rows[0].listingId}`
    : firstListingId
      ? `${PORTAL}/dashboard/listings/${firstListingId}`
      : `${PORTAL}/dashboard/listings`;
  const inner = `
      ${kicker("One week in")}
      ${h1(published ? "Your slideshow is ready for its first buyer" : "Your Seller Report starts with one slideshow")}
      ${p(`Hi ${esc(firstName)},`)}
      ${p("Every listing in the Portal has a Seller Report: how many buyers opened the slideshow, how long they stayed, which photographs they stopped on, and who you sent it to. It&rsquo;s the page you forward when an owner asks what you&rsquo;re doing for their boat.")}
      ${published
        ? p("Your slideshow is live, but no one has opened it this week. Send it to one buyer and the report starts filling in.")
        : p("Publish a slideshow and the report starts filling in. Open a listing, press <strong style=\"color:#111827;\">Create Slideshow</strong>, then send it to one buyer.")}
      ${cta(published ? "Send it to a buyer" : "Publish a slideshow", target)}
      ${p(`Your free trial runs until ${esc(endsOn)}.`, true)}
      ${signoff}`;
  return {
    subject: published ? "Your slideshow is ready for its first buyer" : "Your Seller Report starts with one slideshow",
    html: shell(inner, unsubToken),
  };
}

// ── Two days left ─────────────────────────────────────────────────────────

export function trialEndingEmail(opts: {
  firstName: string;
  endsOn: string; // e.g. "Friday, November 7"
  daysLeft: number; // 2 normally; 1 if the run was a day late
  unsubToken?: string;
}): TrialEmail {
  const { firstName, endsOn, daysLeft, unsubToken } = opts;
  const when = daysLeft <= 1 ? "tomorrow" : "in two days";
  const inner = `
      ${kicker("Your free trial")}
      ${h1(`Your trial ends ${when}`)}
      ${p(`Hi ${esc(firstName)},`)}
      ${p(`Your free trial of the YachtPics Portal ends on <strong style="color:#111827;">${esc(endsOn)}</strong>.`)}
      ${label("What stops")}
      ${list(STOPS)}
      ${label("What stays")}
      ${list(STAYS)}
      ${p(`${PLAN_ONE_LINER} Plans start at $${STARTER_PRICE} a month; choose one now and nothing changes.`)}
      ${cta("See plans", `${PORTAL}/dashboard/billing`)}
      ${signoff}`;
  return { subject: `Your trial ends ${when}`, html: shell(inner, unsubToken) };
}

// ── Ended ─────────────────────────────────────────────────────────────────

export function trialEndedEmail(opts: {
  firstName: string;
  endedOn: string; // e.g. "Friday, November 7"
  unsubToken?: string;
}): TrialEmail {
  const { firstName, endedOn, unsubToken } = opts;
  const inner = `
      ${kicker("Your free trial")}
      ${h1("Your trial has ended")}
      ${p(`Hi ${esc(firstName)},`)}
      ${p(`Your free trial of the YachtPics Portal ended on ${esc(endedOn)}. Your photographs are still yours &mdash; every image we delivered stays free to download, and each listing keeps two reels.`)}
      ${label("What you lose without a plan")}
      ${list(STOPPED)}
      ${p(`${PLAN_PUTS_TO_WORK} Starter brings it all back for $${STARTER_PRICE} a month, for up to five active boats. Your slideshows, sends and reports are where you left them.`)}
      ${cta(`Choose Starter &middot; $${STARTER_PRICE}/month`, `${PORTAL}/dashboard/billing`)}
      ${p("Have a question first? Just reply to this email.", true)}
      ${signoff}`;
  return { subject: "Your trial has ended. Your photos are still free.", html: shell(inner, unsubToken) };
}
