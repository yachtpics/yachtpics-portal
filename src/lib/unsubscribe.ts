// Opt-out / unsubscribe helpers for marketing-class emails (trial reminders,
// product announcements). Transactional mail (welcome, send-to-client, password
// resets) intentionally does NOT use these — those are relationship messages.

const PORTAL = "https://portal.yachtpics.com";

// CAN-SPAM requires a valid physical postal address in marketing email.
export const MAILING_ADDRESS = "YachtPics · 309 Lake Circle, North Palm Beach, FL 33408";

/** Human-friendly unsubscribe page (shown when a broker clicks the footer link). */
export function unsubPageUrl(token: string): string {
  return `${PORTAL}/unsubscribe?token=${token}`;
}

/** One-click endpoint used by the List-Unsubscribe header (RFC 8058). */
export function unsubApiUrl(token: string): string {
  return `${PORTAL}/api/unsubscribe?token=${token}`;
}

/**
 * Headers to merge into the Resend payload so Gmail/Yahoo show a native
 * "Unsubscribe" control and honor one-click opt-out.
 */
export function unsubscribeHeaders(token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubApiUrl(token)}>, <mailto:hello@yachtpics.com?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** Footer block with postal address + unsubscribe link, for marketing emails. */
export function unsubscribeFooterHtml(token: string): string {
  return `<div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0 0 6px;font-size:12px;color:#9ca3af;line-height:1.5;">${MAILING_ADDRESS}</p>
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">Don&rsquo;t want these updates? <a href="${unsubPageUrl(token)}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe here</a>. You&rsquo;ll still get essential account emails.</p>
    </div>`;
}
