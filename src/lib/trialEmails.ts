// Branded HTML for trial lifecycle emails. Styling mirrors the welcome email:
// dark header bar, gold accent, single clear call to action.

const PORTAL = "https://portal.yachtpics.com";

function shell(headline: string, bodyHtml: string, ctaLabel: string, ctaHref: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">${headline}</h1>
      ${bodyHtml}
      <div style="margin:32px 0 8px;">
        <a href="${ctaHref}" style="display:inline-block;background:#d4a843;color:#050b14;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">${ctaLabel}</a>
      </div>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Professional yacht photography &amp; delivery<br>Questions? Just reply to this email.</p>
    </div>
  </div>
</body>
</html>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">${text}</p>`;
}

// Soft "what you'd be setting down" list — benefit-led, no hard sell.
function featureList(intro: string): string {
  const items: [string, string][] = [
    ["Branded client slideshows", "your logo on a clean, full-screen gallery buyers open on any device — no login."],
    ["See who's looking", "track every time a buyer opens your slideshow, so you know which listings are landing."],
    ["Add walkthrough videos", "let a buyer feel the boat before they ever step aboard."],
    ["Upload any listing", "keep your whole portfolio camera-ready, not just the boats we shoot."],
    ["One-tap send to clients", "a polished presentation in their inbox in seconds."],
  ];
  const rows = items
    .map(
      ([h, t]) => `
        <tr>
          <td style="width:16px;vertical-align:top;padding:7px 0 0;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#d4a843;"></span></td>
          <td style="padding:5px 0;font-size:14px;color:#374151;line-height:1.5;"><strong style="color:#111827;">${h}</strong> — ${t}</td>
        </tr>`
    )
    .join("");
  return `<p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.5px;">${intro}</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">${rows}</table>`;
}

/** Sent in the final days of a broker's free trial. */
export function trialExpiringHtml(opts: { firstName: string; daysLeft: number }): string {
  const { firstName, daysLeft } = opts;
  const dayWord = daysLeft === 1 ? "day" : "days";
  const headline = daysLeft <= 1 ? `Your trial ends tomorrow, ${firstName}` : `${daysLeft} ${dayWord} left on your trial, ${firstName}`;
  const body =
    p(`Your free trial of the YachtPics Portal wraps up in <strong style="color:#111827;">${daysLeft} ${dayWord}</strong> — and with it, the tools that make your listings stand out.`) +
    featureList("What stays in your hands with a plan") +
    p(`Your delivered photos always stay free to download. A plan simply keeps the presentation tools above switched on.`);
  return shell(headline, body, "Choose a plan", `${PORTAL}/dashboard/billing`);
}

/** Sent shortly after a broker's free trial has ended without subscribing. */
export function trialLapsedHtml(opts: { firstName: string }): string {
  const { firstName } = opts;
  const headline = `Your trial has ended, ${firstName}`;
  const body =
    p(`Your free trial of the YachtPics Portal has wrapped up. Your photos are safe and still free to download anytime.`) +
    featureList("What switches back on the moment you upgrade") +
    p(`Pick a plan whenever you're ready — it takes about a minute. Have a question first? Just reply to this email and we'll help.`);
  return shell(headline, body, "Reactivate my tools", `${PORTAL}/dashboard/billing`);
}
