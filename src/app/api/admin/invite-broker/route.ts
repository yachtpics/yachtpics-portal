import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const { firstName, lastName, email, brokerage, vesselName, photosReady } = await req.json();

    if (!firstName || !lastName || !email) {
      return NextResponse.json({ error: "First name, last name, and email are required." }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Generate invite link (gives us control over the email)
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo: "https://portal.yachtpics.com/dashboard" },
    });

    if (linkError || !linkData?.user) {
      return NextResponse.json({ error: linkError?.message ?? "Failed to generate invite link." }, { status: 500 });
    }

    const userId = linkData.user.id;
    const inviteLink = linkData.properties?.action_link ?? "https://portal.yachtpics.com";

    // Create profile row
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: userId,
      role: "broker",
      first_name: firstName,
      last_name: lastName,
      display_email: email,
    });

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    // Create broker_details row if brokerage provided
    if (brokerage) {
      await supabase.from("broker_details").upsert({
        id: userId,
        brokerage_name: brokerage,
      });
    }

    // Build email HTML
    const brokerFirst = firstName;
    const hasVessel = vesselName && vesselName.trim().length > 0;

    const photosReadyBlock = hasVessel && photosReady
      ? `<div style="background:#f9f5ec;border:1px solid #e8d9a0;border-radius:10px;padding:20px 24px;margin:0 0 28px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#92721a;text-transform:uppercase;letter-spacing:0.5px;">Photos Ready</p>
          <p style="margin:0;font-size:15px;color:#111827;line-height:1.5;">Your professional photos for <strong>${hasVessel ? vesselName : ""}</strong> are ready and waiting in your portal. Once you set up your account, head to your listings to view, download, and share them.</p>
        </div>`
      : hasVessel && !photosReady
      ? `<div style="background:#f9f5ec;border:1px solid #e8d9a0;border-radius:10px;padding:20px 24px;margin:0 0 28px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#92721a;text-transform:uppercase;letter-spacing:0.5px;">Photos Coming Soon</p>
          <p style="margin:0;font-size:15px;color:#111827;line-height:1.5;">We're processing your photos for <strong>${hasVessel ? vesselName : ""}</strong>. You'll find them in your portal once they're ready.</p>
        </div>`
      : "";

    const subheading = hasVessel && photosReady
      ? `Your YachtPics Portal account is set up and your photos for <strong style="color:#111827;">${vesselName}</strong> are ready to view.`
      : hasVessel
      ? `Your YachtPics Portal account is set up. We're working on your photos for <strong style="color:#111827;">${vesselName}</strong>.`
      : "Your YachtPics Portal account has been created. Click below to set your password and get started.";

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Welcome, ${brokerFirst}</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">${subheading}</p>
      ${photosReadyBlock}
      <a href="${inviteLink}" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:20px;">Set Up Your Account &rarr;</a>
      <p style="margin:0 0 20px;font-size:13px;color:#6b7280;line-height:1.6;">When you click the button above, you'll be prompted to create a password for your account. Please choose a secure password and keep it somewhere safe — you'll use it each time you log in.</p>
      <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">From your portal you can view and download your photos, share a professional slideshow with clients, manage your listings, and track who's viewing your content.</p>
    </div>
    <div style="padding:24px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#c4c9d4;">Powered by <a href="https://yachtpics.com" style="color:#c4c9d4;text-decoration:none;">YachtPics</a></p>
    </div>
  </div>
</body>
</html>`;

    const subject = hasVessel && photosReady
      ? `Your YachtPics Portal is ready — photos for ${vesselName} are in`
      : hasVessel
      ? `Your YachtPics Portal is ready — photos for ${vesselName} coming soon`
      : "You've been invited to YachtPics Portal";

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "YachtPics <hello@yachtpics.com>",
        to: email,
        subject,
        html,
      }),
    });

    const resendData = await resendRes.json();
    if (!resendRes.ok) {
      return NextResponse.json({ error: resendData.message ?? "Invite created but email failed to send." }, { status: 500 });
    }

    return NextResponse.json({ success: true, brokerId: userId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
