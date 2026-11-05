// Email sent to a broker when someone opens one of their client slideshows.
// It says who (when the view came through a tracked Send to Client link),
// where the view came from, and what else we know about the visit.
const PORTAL = "https://portal.yachtpics.com";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ordinal = (n: number) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
};

export type ViewEmailOpts = {
  firstName: string;
  vesselName: string | null;
  listingId: string;
  /** Tracked recipient's name (or email when no name was given). Null for an unnamed view. */
  who?: string | null;
  /** Tracked recipient's email, shown when it differs from `who`. */
  whoEmail?: string | null;
  /** How many times this recipient has opened their link, this one included. */
  openCount?: number | null;
  /** When the slideshow was sent to this recipient, already formatted (Eastern). */
  sentAt?: string | null;
  /** Short source name, e.g. "Direct link". */
  sourceLabel: string;
  /** One sentence on what that source means. */
  sourceDetail: string;
  /** When the view happened, already formatted (Eastern). */
  viewedAt: string;
  /** Approximate location from the viewer's network, e.g. "Fort Lauderdale, FL". */
  location?: string | null;
  /** e.g. "iPhone · Safari". */
  device?: string | null;
  /** Site the viewer clicked through from, e.g. "facebook.com". */
  referrer?: string | null;
  /** Listing totals, this view included. */
  views7d?: number | null;
  views30d?: number | null;
  viewsAll?: number | null;
  /** The view before this one, already formatted (Eastern). */
  previousViewAt?: string | null;
  /** Whether the broker can send tracked links (has a plan / trial / comp). */
  canSend?: boolean;
};

/** Subject line shared by the email and its log row. */
export function viewEmailSubject(opts: { who?: string | null; vesselName: string | null; sourceLabel: string }): string {
  const boat = opts.vesselName ?? "your listing";
  return opts.who
    ? `${opts.who} opened your slideshow — ${boat}`
    : `New view on ${boat} — via ${opts.sourceLabel}`;
}

export function buyerViewEmailHtml(opts: ViewEmailOpts): string {
  const { firstName, vesselName, listingId, openCount } = opts;
  const boat = esc(vesselName ?? "your listing");
  const who = opts.who ? esc(opts.who) : null;
  const strong = (s: string) => `<strong style="color:#111827;">${s}</strong>`;

  const heading = who ? `${who} is looking, ${esc(firstName)}` : `New view on ${boat}`;

  const lead = who
    ? `${strong(who)} just opened your slideshow for ${strong(boat)}${openCount && openCount > 1 ? ` &mdash; their ${ordinal(openCount)} look` : ""}. Good moment for a follow-up while she's top of mind.`
    : `Someone just opened your slideshow for ${strong(boat)}. ${esc(opts.sourceDetail)}`;

  const rows: [string, string][] = [];
  if (who) {
    const email = opts.whoEmail && opts.whoEmail !== opts.who ? ` &middot; <a href="mailto:${esc(opts.whoEmail)}" style="color:#84662a;text-decoration:none;">${esc(opts.whoEmail)}</a>` : "";
    rows.push(["Who", `${who}${email}`]);
    if (opts.sentAt) rows.push(["Sent to them", esc(opts.sentAt)]);
    if (openCount) rows.push(["Opens so far", `${openCount}`]);
  } else {
    rows.push(["Who", "No name &mdash; not a tracked send"]);
  }
  rows.push(["Came from", esc(opts.sourceLabel)]);
  if (opts.referrer) rows.push(["Clicked through from", esc(opts.referrer)]);
  rows.push(["When", esc(opts.viewedAt)]);
  if (opts.location) rows.push(["Approx. location", esc(opts.location)]);
  if (opts.device) rows.push(["Device", esc(opts.device)]);

  const activity: string[] = [];
  if (typeof opts.views7d === "number") activity.push(`${opts.views7d} in the last 7 days`);
  if (typeof opts.views30d === "number") activity.push(`${opts.views30d} in the last 30`);
  if (typeof opts.viewsAll === "number") activity.push(`${opts.viewsAll} all time`);
  if (activity.length) rows.push(["Her views", activity.join(" &middot; ")]);
  if (opts.previousViewAt) rows.push(["Previous view", esc(opts.previousViewAt)]);

  const table = rows
    .map(([k, v], i) => `<tr>
          <td style="padding:10px 16px 10px 0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;white-space:nowrap;vertical-align:top;${i ? "border-top:1px solid #f3f4f6;" : ""}">${k}</td>
          <td style="padding:10px 0;font-size:14px;color:#111827;line-height:1.5;${i ? "border-top:1px solid #f3f4f6;" : ""}">${v}</td>
        </tr>`)
    .join("");

  // An unnamed view is the moment a broker asks "who was it?" — say how to know next time.
  const tip = who
    ? ""
    : `<p style="margin:0 0 24px;font-size:14px;color:#374151;line-height:1.6;background:#faf7f0;border-left:3px solid #c39e4e;padding:12px 16px;">${
        opts.canSend === false
          ? `Want a name next time? With a plan, ${strong("Send to Client")} gives each buyer a personal link, so this email tells you who opened her and how many times.`
          : `Want a name next time? Send her from the listing with ${strong("Send to Client")}. Each buyer gets a personal link, so this email tells you who opened her and how many times.`
      }</p>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">${heading}</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">${lead}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 24px;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
        ${table}
      </table>
      ${tip}
      <a href="${PORTAL}/report/listing/${listingId}" style="display:inline-block;background:#c39e4e;color:#050b14;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:8px;">Open her Seller Report</a>
      <p style="margin:16px 0 0;font-size:14px;line-height:1.6;"><a href="${PORTAL}/dashboard/listings/${listingId}" style="color:#84662a;font-weight:600;text-decoration:none;">View this listing &rarr;</a></p>
      <p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">This went out the moment the slideshow opened. How long they stayed and which photos they lingered on show up in the Seller Report once the visit ends.${opts.location ? " Location is approximate, based on the viewer's network." : ""}</p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">You're getting this because view alerts are on. Turn them off anytime under My Profile &rarr; Notifications.</p>
    </div>
  </div>
</body>
</html>`;
}
