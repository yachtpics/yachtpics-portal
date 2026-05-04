import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch profile + first listing (if any)
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, display_email")
      .eq("id", userId)
      .single();

    if (!profile?.display_email) {
      return NextResponse.json({ error: "No email on file" }, { status: 400 });
    }

    const { data: listings } = await supabase
      .from("listings")
      .select("id, vessel_name")
      .eq("broker_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    const firstName = profile.first_name ?? "there";
    const email = profile.display_email;
    const hasListing = listings && listings.length > 0;
    const vesselName = hasListing ? listings[0].vessel_name : null;
    const portalUrl = "https://portal.yachtpics.com/dashboard";

    const photosLine = vesselName
      ? `Your photos for <strong style="color:#111827;">${vesselName}</strong> are already in your portal, ready to share.`
      : "As soon as your photos are delivered, you'll find them waiting here.";

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">You're all set, ${firstName}</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">${photosLine}</p>

      <p style="margin:0 0 16px;font-size:14px;font-weight:600;color:#111827;text-transform:uppercase;letter-spacing:0.5px;">Quick Start</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:32px;">
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #f3f4f6;vertical-align:top;">
            <span style="display:inline-block;background:#d4a843;color:#050b14;font-size:12px;font-weight:700;width:22px;height:22px;border-radius:50%;text-align:center;line-height:22px;margin-right:12px;flex-shrink:0;">1</span>
            <span style="font-size:14px;color:#374151;"><strong style="color:#111827;">View your photos</strong> — open Listings to see everything we delivered.</span>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #f3f4f6;vertical-align:top;">
            <span style="display:inline-block;background:#d4a843;color:#050b14;font-size:12px;font-weight:700;width:22px;height:22px;border-radius:50%;text-align:center;line-height:22px;margin-right:12px;">2</span>
            <span style="font-size:14px;color:#374151;"><strong style="color:#111827;">Share with a client</strong> — hit &ldquo;Send to Client&rdquo; to email them a professional slideshow link.</span>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 0;vertical-align:top;">
            <span style="display:inline-block;background:#d4a843;color:#050b14;font-size:12px;font-weight:700;width:22px;height:22px;border-radius:50%;text-align:center;line-height:22px;margin-right:12px;">3</span>
            <span style="font-size:14px;color:#374151;"><strong style="color:#111827;">Download anytime</strong> — grab full-resolution files directly from your listing page.</span>
          </td>
        </tr>
      </table>

      <a href="${portalUrl}" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:32px;">Open My Portal &rarr;</a>

      <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">Questions or need anything adjusted? Just reply to this email — we're here.</p>
    </div>
    <div style="padding:24px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#c4c9d4;">Powered by <a href="https://yachtpics.com" style="color:#c4c9d4;text-decoration:none;">YachtPics</a></p>
    </div>
  </div>
</body>
</html>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "YachtPics <hello@yachtpics.com>",
        to: email,
        subject: `Welcome to YachtPics Portal — here's how to get started`,
        html,
      }),
    });

    const resendData = await resendRes.json();
    if (!resendRes.ok) {
      return NextResponse.json({ error: resendData.message ?? "Failed to send" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
