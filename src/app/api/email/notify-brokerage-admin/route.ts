import { NextRequest, NextResponse } from "next/server";
import { logEmail } from "@/lib/logEmail";
import { requireAdmin } from "@/lib/requireAdmin";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const supabase = auth.admin;

    const body = await req.json();
    const listingId: unknown = body?.listingId;
    if (typeof listingId !== "string" || !listingId) {
      return NextResponse.json({ error: "Missing listingId" }, { status: 400 });
    }
    const mediaType: "photos" | "video" | "both" =
      body?.mediaType === "video" || body?.mediaType === "both" ? body.mediaType : "photos";
    // The assistant route ran alongside this one, so anyone who is both a
    // brokerage admin and an assistant of this broker has already been emailed.
    const excludeAssistants: boolean = body?.excludeAssistants === true;

    // Get listing + broker info (the broker's brokerage is what we notify)
    const { data: listing, error } = await supabase
      .from("listings")
      .select("id, broker_id, vessel_name, profiles:broker_id(first_name, last_name, display_email, brokerage_id)")
      .eq("id", listingId)
      .single();

    if (error || !listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

    const broker = listing.profiles as unknown as {
      first_name: string | null;
      last_name: string | null;
      display_email: string | null;
      brokerage_id: string | null;
    } | null;

    const brokerageId = broker?.brokerage_id ?? null;
    if (!brokerageId) {
      return NextResponse.json({ success: true, sent: 0, message: "Broker isn't part of a brokerage." });
    }

    const brokerName = broker?.first_name ? `${broker.first_name} ${broker.last_name ?? ""}`.trim() : "the broker";
    const vesselName = listing.vessel_name ?? "the vessel";

    const { data: brokerage } = await supabase
      .from("brokerages")
      .select("name")
      .eq("id", brokerageId)
      .maybeSingle();
    const brokerageName = (brokerage?.name as string | null) ?? "the brokerage";

    // Deep link straight to the boat. An earlier version of this file sent
    // brokerage admins to /dashboard instead, on the belief that a deep link
    // would 403 because assertListingAccess admits only the listing's broker, a
    // linked assistant, a co-broker or a YachtPics admin. That reasoning was
    // about the wrong layer: /dashboard/listings/[id] never calls
    // assertListingAccess — it reads the listings table directly under the
    // user's own session, and RLS admits brokerage admins through the brokerage
    // clause inside assistant_has_access() (same brokerage_id, is_brokerage_admin
    // true), which backs the FOR ALL policy "Assistants manage linked broker
    // listings". So the deep link resolves for exactly the people this email
    // goes to. The vessel is still named in the body below.
    const portalUrl = `https://portal.yachtpics.com/dashboard/listings/${listing.id}`;

    // Every brokerage admin for this brokerage, minus the broker themself.
    const { data: adminRows } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, display_email")
      .eq("brokerage_id", brokerageId)
      .eq("is_brokerage_admin", true)
      .not("display_email", "is", null);

    type AdminProfile = { id: string; first_name: string | null; last_name: string | null; display_email: string | null };

    const candidates = ((adminRows ?? []) as unknown as AdminProfile[]).filter((p) => !!p.display_email);

    // Plain object rather than a Set — this project compiles to ES5.
    const excludedIds: Record<string, boolean> = {};
    excludedIds[listing.broker_id as string] = true;
    if (excludeAssistants) {
      const { data: links } = await supabase
        .from("broker_assistants")
        .select("assistant_id")
        .eq("broker_id", listing.broker_id);
      (links ?? []).forEach((l) => {
        excludedIds[l.assistant_id as string] = true;
      });
    }

    const admins = candidates.filter((p) => !excludedIds[p.id]);

    if (admins.length === 0) {
      return NextResponse.json({
        success: true,
        sent: 0,
        message:
          candidates.length > 0
            ? "Brokerage admin already notified."
            : "No brokerage admin to notify.",
      });
    }

    // Tailor wording to what was delivered: photos, video, or both.
    const copy =
      mediaType === "video"
        ? {
            subjectLabel: "Video",
            headingPrefix: "Video ready for",
            blurb: `Professional video for <strong style="color:#111827;">${vesselName}</strong> has been delivered to <strong style="color:#111827;">${brokerName}</strong>'s portal at <strong style="color:#111827;">${brokerageName}</strong> and is ready to share with clients.`,
          }
        : mediaType === "both"
        ? {
            subjectLabel: "Photos & video",
            headingPrefix: "Photos &amp; video ready for",
            blurb: `Professional photos and video for <strong style="color:#111827;">${vesselName}</strong> have been delivered to <strong style="color:#111827;">${brokerName}</strong>'s portal at <strong style="color:#111827;">${brokerageName}</strong> and are ready to share with clients.`,
          }
        : {
            subjectLabel: "Photos",
            headingPrefix: "Photos ready for",
            blurb: `Professional photos for <strong style="color:#111827;">${vesselName}</strong> have been delivered to <strong style="color:#111827;">${brokerName}</strong>'s portal at <strong style="color:#111827;">${brokerageName}</strong> and are ready to share with clients.`,
          };

    const subject = `${copy.subjectLabel} ready for ${vesselName} — ${brokerName}'s listing`;
    const year = new Date().getFullYear();

    // Send to each brokerage admin
    const results = await Promise.allSettled(
      admins.map(async (admin) => {
        const adminName = admin.first_name ? `${admin.first_name} ${admin.last_name ?? ""}`.trim() : "there";

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);"><div style="background:#050b14;padding:32px 40px;"><p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p></div><div style="padding:40px;"><h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">${copy.headingPrefix} ${brokerName}, ${adminName}</h1><p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">${copy.blurb}</p><p style="margin:0 0 32px;font-size:15px;color:#6b7280;line-height:1.6;">You're receiving this as a brokerage admin at ${brokerageName}. The listing is in ${brokerName}'s portal — open it to see where your brokerage's media stands.</p><a href="${portalUrl}" style="display:inline-block;background:#c39e4e;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;">Open ${vesselName} &rarr;</a></div><div style="padding:24px 40px;border-top:1px solid #f3f4f6;"><p style="margin:0 0 8px;font-size:13px;color:#9ca3af;">YachtPics &middot; Professional Yacht Photography<br>Questions? Reply to this email or visit <a href="https://yachtpics.com" style="color:#84662a;">yachtpics.com</a></p><p style="margin:0;font-size:11px;color:#d1d5db;line-height:1.5;">&copy; ${year} YachtPics. All photos and videos remain the intellectual property of YachtPics. Your payment grants a non-exclusive, non-transferable license to advertise the specific vessel shown. Sharing or transferring these files to any third party without a separate written license from YachtPics is prohibited.</p></div></div></body></html>`;

        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "YachtPics <hello@yachtpics.com>",
            to: admin.display_email!,
            subject,
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
          recipientEmail: admin.display_email!,
          recipientRole: "brokerage_admin",
          recipientId: admin.id,
          brokerId: listing.broker_id,
          listingId: listing.id,
          subject,
          status: ok ? "sent" : "failed",
          error: errMsg,
          metadata: { mediaType, broker: brokerName, brokerage: brokerageName },
        });

        if (!ok) throw new Error(errMsg ?? "Failed to send");
      })
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    // Who actually got the email, so the admin page can name them.
    const names = admins
      .filter((_, i) => results[i].status === "fulfilled")
      .map((a) => (a.first_name ? `${a.first_name} ${a.last_name ?? ""}`.trim() : a.display_email!));

    return NextResponse.json({ success: true, sent, failed, names });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
