/**
 * "Yachting this week" — the weekly piece, from draft to inbox.
 *
 * The daily feed needs no hands. This does: Claude drafts it on Monday
 * morning, Charlie reads it, edits it, approves it, and only then does it go
 * anywhere. Everything here is the plumbing between those steps — turning the
 * markdown into HTML, and wrapping that HTML in the portal's email.
 *
 * The digest email is marketing-class: it carries the unsubscribe footer and
 * goes only to people who haven't opted out, exactly like the announcement.
 */

import { unsubscribeFooterHtml } from "@/lib/unsubscribe";

const PORTAL = "https://portal.yachtpics.com";

/** A row of `news_digests`, as every page and route here reads it. */
export type DigestRow = {
  id: string;
  week_start: string;
  title: string;
  intro: string;
  body_md: string;
  html: string | null;
  status: string;
  item_ids: string[] | null;
  created_at: string | null;
  approved_at: string | null;
  sent_at: string | null;
};

/** One select list, so the shape a route returns always matches `DigestRow`. */
export const DIGEST_SELECT =
  "id, week_start, title, intro, body_md, html, status, item_ids, created_at, approved_at, sent_at";

/**
 * The email_log type for one week's send. Deduping on this is what stops a
 * second click on "Approve & send" from delivering the piece twice.
 */
export function digestEmailType(weekStart: string): string {
  return `news_digest_${weekStart}`;
}

/** "September 15, 2026" — the Monday a piece belongs to, written out. */
export function digestWeekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return weekStart;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Eastern day of week, 0 = Sunday … 6 = Saturday. The portal's clock is ET. */
export function etDayOfWeek(now: Date = new Date()): number {
  return new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
}

/**
 * The Monday of the current Eastern week, as `YYYY-MM-DD`.
 *
 * `week_start` is unique in the table, so this doubles as the key that stops
 * the Monday job writing a second draft for a week that already has one.
 */
export function etWeekStart(now: Date = new Date()): string {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  // getDay(): Sun 0 … Sat 6. Days to step back to reach Monday.
  const back = (et.getDay() + 6) % 7;
  et.setDate(et.getDate() - back);
  const y = et.getFullYear();
  const m = String(et.getMonth() + 1).padStart(2, "0");
  const d = String(et.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Everything that could close a tag or open a script stops being itself here. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The only two marks the piece is allowed: *emphasis* and **strong**.
 *
 * The text is escaped FIRST, so nothing a model (or a hand edit) writes can
 * introduce markup — the asterisks are matched afterwards against text that is
 * already inert.
 */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

const PARA_STYLE = "margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;";

/**
 * Markdown to paragraphs. A blank line starts a new one; a single newline
 * inside a paragraph is just a wrapped line and becomes a space.
 *
 * Deliberately not a markdown parser. The piece is four to six paragraphs of
 * prose — no headings, no lists, no links — and a parser we don't need is a
 * parser that can surprise us in a broker's inbox.
 */
export function renderDigestHtml(digest: { body_md: string }): string {
  return (digest.body_md || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p style="${PARA_STYLE}">${inline(block.replace(/\s*\n\s*/g, " "))}</p>`)
    .join("\n");
}

/**
 * The weekly piece as an email, in the same clothes as the announcement and
 * the tips: dark header, the piece, a link back to the portal, a quiet line
 * about where it came from, and the unsubscribe footer underneath.
 */
export function digestEmailHtml(opts: {
  firstName: string;
  digest: { title: string; intro: string; body_md: string; html?: string | null };
  unsubToken?: string;
}): string {
  const { firstName, digest, unsubToken } = opts;
  const unsubFooter = unsubToken ? unsubscribeFooterHtml(unsubToken) : "";
  // Prefer the HTML stored at approval — that's the copy Charlie read.
  const bodyHtml = digest.html && digest.html.trim().length > 0 ? digest.html : renderDigestHtml(digest);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#84662a;text-transform:uppercase;">Yachting this week</p>
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">${escapeHtml(digest.title)}</h1>
      <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
      <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.6;">${inline(digest.intro)}</p>
      ${bodyHtml}
      <div style="margin:28px 0 8px;">
        <a href="${PORTAL}/dashboard/news" style="display:inline-block;background:#c39e4e;color:#050b14;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">Read the week&rsquo;s stories</a>
      </div>
      <p style="margin:24px 0 0;font-size:14px;color:#374151;line-height:1.6;">— Charlie &amp; Samantha<br><span style="color:#9ca3af;">YachtPics</span></p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0 0 6px;font-size:12px;color:#9ca3af;line-height:1.5;">Made with the YachtPics Portal</p>
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Professional yacht photography &amp; delivery<br>Questions? Just reply to this email.</p>
    </div>${unsubFooter}
  </div>
</body>
</html>`;
}
