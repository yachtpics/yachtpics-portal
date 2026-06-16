import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";

export async function POST(req: NextRequest) {
  try {
    const { listingId, mediaType = "photos" } = await req.json();
    if (!listingId) return NextResponse.json({ error: "Missing listingId" }, { status: 400 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: listing, error } = await supabase
      .from("listings")
      .select("id, vessel_name, location, broker_id, profiles(first_name, last_name, display_email)")
      .eq("id", listingId)
      .single();

    if (error || !listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

    const profile = listing.profiles as unknown as { first_name: string | null; last_name: string | null; display_email: string | null } | null;
    const brokerEmail = profile?.display_email;
    const brokerName = profile?.first_name ? `${profile.first_name} ${profile.last_name ?? ""}`.trim() : "there";
    const vesselName = listing.vessel_name ?? "your vessel";
    const portalUrl = `https://portal.yachtpics.com/dashboard/listings/${listing.id}`;

    if (!brokerEmail) return NextResponse.json({ error: "Broker has no email on file" }, { status: 400 });

    // Tailor the wording to what was actually delivered: photos, video, or both.
    const copy =
      mediaType === "video"
        ? {
            subject: `Your video for ${vesselName} is ready`,
            heading: "Your video is ready",
            blurb: `Your professional video for <strong style="color:#111827;">${vesselName}</strong> has been delivered and is available in your portal.`,
            cta: "View Your Video",
          }
        : mediaType === "both"
        ? {
            subject: `Your photos &amp; video for ${vesselName} are ready`,
            heading: "Your photos and video are ready",
            blurb: `Your professional photos and video for <strong style="color:#111827;">${vesselName}</strong> have been delivered and are available in your portal.`,
            cta: "View Your Media",
          }
        : {
            subject: `Your photos for ${vesselName} are ready`,
            heading: "Your photos are ready",
            blurb: `Your professional photos for <strong style="color:#111827;">${vesselName}</strong> have been delivered and are available in your portal.`,
            cta: "View Your Photos",
          };

    const year = new Date().getFullYear();
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);"><div style="background:#050b14;padding:32px 40px;"><p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Portal</span></p></div><div style="padding:40px;"><h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">${copy.heading}, ${brokerName}</h1><p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">${copy.blurb}</p><p style="margin:0 0 32px;font-size:15px;color:#6b7280;line-height:1.6;">You can view, download, and share with clients directly from your listing.</p><a href="${portalUrl}" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;">${copy.cta} &rarr;</a></div><div style="padding:24px 40px;border-top:1px solid #f3f4f6;"><p style="margin:0 0 8px;font-size:13px;color:#9ca3af;">YachtPics &middot; Professional Yacht Photography<br>Questions? Reply to this email or visit <a href="https://yachtpics.com" style="color:#d4a843;">yachtpics.com</a></p><p style="margin:0;font-size:11px;color:#d1d5db;line-height:1.5;">&copy; ${year} YachtPics. All photos and videos remain the intellectual property of YachtPics. Your payment grants a non-exclusive, non-transferable license to advertise the specific vessel shown. Sharing or transferring these files to any third party without a separate written license from YachtPics is prohibited.</p></div></div></body></html>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "YachtPics <hello@yachtpics.com>",
        to: brokerEmail,
        subject: copy.subject,
        html,
      }),
    });

    const resendData = await resendRes.json();

    await logEmail({
      emailType: mediaType === "video" ? "video_ready" : mediaType === "both" ? "media_ready" : "photos_ready",
      recipientEmail: brokerEmail,
      recipientRole: "broker",
      recipientId: listing.broker_id,
      brokerId: listing.broker_id,
      listingId: listing.id,
      subject: copy.subject,
      status: resendRes.ok ? "sent" : "failed",
      error: resendRes.ok ? null : (resendData.message ?? "Failed to send"),
      metadata: { mediaType },
    });

    if (!resendRes.ok) return NextResponse.json({ error: resendData.message ?? "Failed to send" }, { status: 500 });

    return NextResponse.json({ success: true, emailId: resendData.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
