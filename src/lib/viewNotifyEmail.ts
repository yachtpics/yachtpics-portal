// Email sent to a broker when a buyer opens one of their client slideshows.
const PORTAL = "https://portal.yachtpics.com";

export function buyerViewEmailHtml(opts: { firstName: string; vesselName: string | null; listingId: string }): string {
  const { firstName, vesselName, listingId } = opts;
  const boat = vesselName ?? "your listing";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Someone's looking, ${firstName}</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">A buyer just opened your slideshow for <strong style="color:#111827;">${boat}</strong>. Good moment for a follow-up while it's top of mind.</p>
      <a href="${PORTAL}/dashboard/listings/${listingId}" style="display:inline-block;background:#c39e4e;color:#050b14;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:8px;">View this listing</a>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">You're getting this because view alerts are on. Turn them off anytime under My Profile &rarr; Notifications.</p>
    </div>
  </div>
</body>
</html>`;
}
