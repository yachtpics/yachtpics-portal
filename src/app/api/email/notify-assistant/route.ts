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

    // Get listing + broker info
    const { data: listing, error } = await supabase
      .from("listings")
      .select("id, vessel_name, broker_id, profiles(first_name, last_name, display_email)")
      .eq("id", listingId)
      .single();

    if (error || !listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

    const broker = listing.profiles as unknown as { first_name: string | null; last_name: string | null; display_email: string | null } | null;
    const brokerName = broker?.first_name ? `${broker.first_name} ${broker.last_name ?? ""}`.trim() : "the broker";
    const vesselName = listing.vessel_name ?? "the vessel";
    const portalUrl = `https://portal.yachtpics.com/dashboard/listings/${listing.id}`;

    // Find all assistants linked to this broker
    const { data: links } = await supabase
      .from("broker_assistants")
      .select("assistant_id, profiles:assistant_id(first_name, last_name, display_email)")
      .eq("broker_id", listing.broker_id);

    if (!links || links.length === 0) {
      return NextResponse.json({ success: true, sent: 0, message: "No assistants linked to this broker." });
    }

    type AssistantProfile = { first_name: string | null; last_name: string | null; display_email: string | null };

    const assistants = links
      .map((l) => l.profiles as unknown as AssistantProfile | null)
      .filter((p): p is AssistantProfile => !!p?.display_email);

    if (assistants.length === 0) {
      return NextResponse.json({ success: true, sent: 0, message: "No assistant emails on file." });
    }

    // Tailor wording to what was delivered: photos, video, or both.
    const copy =
      mediaType === "video"
        ? {
            subjectLabel: "Video",
            headingPrefix: "Video ready for",
            blurb: `Professional video for <strong style="color:#111827;">${vesselName}</strong> has been delivered to <strong style="color:#111827;">${brokerName}</strong>'s portal and is ready to share with clients.`,
          }
        : mediaType === "both"
        ? {
            subjectLabel: "Photos &amp; video",
            headingPrefix: "Photos &amp; video ready for",
            blurb: `Professional photos and video for <strong style="color:#111827;">${vesselName}</strong> have been delivered to <strong style="color:#111827;">${brokerName}</strong>'s portal and are ready to share with clients.`,
          }
        : {
            subjectLabel: "Photos",
            headingPrefix: "Photos ready for",
            blurb: `Professional photos for <strong style="color:#111827;">${vesselName}</strong> have been delivered to <strong style="color:#111827;">${brokerName}</strong>'s portal and are ready to share with clients.`,
          };

    const year = new Date().getFullYear();

    // Send to each assistant
    const results = await Promise.allSettled(
      assistants.map(async (assistant) => {
        const assistantName = assistant.first_name
          ? `${assistant.first_name} ${assistant.last_name ?? ""}`.trim()
          : "there";

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);"><div style="background:#050b14;padding:32px 40px;"><p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Portal</span></p></div><div style="padding:40px;"><h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">${copy.headingPrefix} ${brokerName}, ${assistantName}</h1><p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">${copy.blurb}</p><p style="margin:0 0 32px;font-size:15px;color:#6b7280;line-height:1.6;">You can view, organize, and send the slideshow directly from the listing.</p><a href="${portalUrl}" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;">View Listing &rarr;</a></div><div style="padding:24px 40px;border-top:1px solid #f3f4f6;"><p style="margin:0 0 8px;font-size:13px;color:#9ca3af;">YachtPics &middot; Professional Yacht Photography<br>Questions? Reply to this email or visit <a href="https://yachtpics.com" style="color:#d4a843;">yachtpics.com</a></p><p style="margin:0;font-size:11px;color:#d1d5db;line-height:1.5;">&copy; ${year} YachtPics. All photos and videos remain the intellectual property of YachtPics. Your payment grants a non-exclusive, non-transferable license to advertise the specific vessel shown. Sharing or transferring these files to any third party without a separate written license from YachtPics is prohibited.</p></div></div></body></html>`;

        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "YachtPics <hello@yachtpics.com>",
            to: assistant.display_email!,
            subject: `${copy.subjectLabel} ready for ${vesselName} — ${brokerName}'s listing`,
            html,
          }),
        });

        const ok = resendRes.ok;
        let errMsg: string | null = null;
        if (!ok) {
          const errData = await resendRes.json().catch(() => ({}));
          errMsg = errData.message ?? "Failed to send";
        }

        await logEmail({
          emailType: mediaType === "video" ? "video_ready" : mediaType === "both" ? "media_ready" : "photos_ready",
          recipientEmail: assistant.display_email!,
          recipientRole: "assistant",
          brokerId: listing.broker_id,
          listingId: listing.id,
          subject: `${copy.subjectLabel} ready for ${vesselName} — ${brokerName}'s listing`,
          status: ok ? "sent" : "failed",
          error: errMsg,
          metadata: { mediaType, broker: brokerName },
        });

        if (!ok) throw new Error(errMsg ?? "Failed to send");
      })
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return NextResponse.json({ success: true, sent, failed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
