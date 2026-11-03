import { NextRequest, NextResponse } from "next/server";
import { logEmail } from "@/lib/logEmail";
import { requireAdmin } from "@/lib/requireAdmin";
import { slideshowPublishUpdate } from "@/lib/slideshowPublish";
import { buildEverydayDockCard } from "@/lib/dockCardAssets";

/** Attach the everyday dock card to the photos-ready email (and publish a never-published slideshow for it). Off until Charlie decides. */
const DOCK_CARD_IN_DELIVERY_EMAIL = false;

export const runtime = "nodejs";
// Building the dock card fetches and resizes the cover photo.
export const maxDuration = 60;

/** Attach the card only below this; above it, a download button instead. */
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    // Only admins deliver media, so only admins may fire the "ready" email.
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
    // The admin page passes false when the send is "broker only", so the
    // assistants don't get a push for an email they were deliberately left off.
    const pushAssistants: boolean = body?.pushAssistants !== false;

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

    // ── Dock card (Nov 1) ────────────────────────────────────────────────────
    // Every delivery carries the boat's everyday dock card (src/lib/
    // dockCardAssets.ts) — its QR is the YachtPics always-live link, so it
    // works with or without a plan. The card needs a published slideshow, so
    // a boat whose slideshow was NEVER published (no slug yet) is published
    // here with the shared Create Slideshow update (src/lib/slideshowPublish.ts
    // — two columns, no side effects; the broker's /s link stays private while
    // they have no plan), stamped slideshow_prepared_by = this admin, exactly
    // as the Oct 29 "Slideshow ready" preparer does. A slideshow the broker
    // UNPUBLISHED (it has a slug) is left alone: the email says the card will
    // be ready once it's published.
    // Charlie (Nov 1): OFF for now while he decides how much of the card to
    // give away without a plan. Flip DOCK_CARD_IN_DELIVERY_EMAIL to put the
    // card (and the auto-publish) back into every delivery.
    let dockCard: { status: "attached" | "button" | "unpublished" | "none"; detail?: string } = { status: "none" };
    const attachments: { filename: string; content: string }[] = [];
    if (DOCK_CARD_IN_DELIVERY_EMAIL) try {
      const { data: ss } = await supabase
        .from("listings")
        .select("slideshow_slug, slideshow_published")
        .eq("id", listing.id)
        .maybeSingle();
      let published = ss?.slideshow_published === true;
      if (!published && !ss?.slideshow_slug) {
        const { count: visible } = await supabase
          .from("photos")
          .select("id", { count: "exact", head: true })
          .eq("listing_id", listing.id)
          .eq("is_visible", true);
        if ((visible ?? 0) > 0) {
          const update = { ...slideshowPublishUpdate(null), slideshow_prepared_by: auth.userId, slideshow_prepared_at: new Date().toISOString() };
          let { error: pubErr } = await supabase.from("listings").update(update).eq("id", listing.id);
          if (pubErr && /slideshow_prepared/.test(pubErr.message ?? "")) {
            ({ error: pubErr } = await supabase.from("listings").update(slideshowPublishUpdate(null)).eq("id", listing.id));
          }
          published = !pubErr;
        }
      }
      if (!published && ss?.slideshow_slug) {
        dockCard = { status: "unpublished" };
      } else if (published) {
        // A lighter cover (1600 px, q82) keeps the attachment well under 1 MB.
        const card = await buildEverydayDockCard(supabase, listing.id, "5x7", { photoEdge: 1600, photoQuality: 82 });
        if (card.ok && card.pdf.byteLength <= MAX_ATTACHMENT_BYTES) {
          attachments.push({ filename: `${card.fileName}.pdf`, content: Buffer.from(card.pdf).toString("base64") });
          dockCard = { status: "attached", detail: String(card.pdf.byteLength) };
        } else {
          dockCard = { status: "button", detail: card.ok ? `too large (${card.pdf.byteLength} bytes)` : card.error };
        }
      }
    } catch (e) {
      // Never block the delivery email on the card.
      dockCard = { status: "button", detail: e instanceof Error ? e.message : "error" };
    }
    const cardUrl = `https://portal.yachtpics.com/api/listings/${listing.id}/dock-card?size=5x7`;
    const letterUrl = `https://portal.yachtpics.com/api/listings/${listing.id}/dock-card?size=letter`;
    const cardBlurb = "her photograph, her specifications, your name, and a QR code that opens her slideshow and video. Print it and leave it aboard for showings. Every scan is counted on her Seller Report.";
    const dockCardHtml =
      dockCard.status === "attached"
        ? `<div style="margin:28px 0 0;padding:16px 20px;background:#f8f3ea;border:1px solid #eaddc1;border-radius:8px;"><p style="margin:0;font-size:14px;color:#6b5a2a;line-height:1.6;"><strong style="color:#4a3d17;">Her dock card is attached</strong> &mdash; a 5&times;7 with ${cardBlurb} <a href="${letterUrl}" style="color:#84662a;">Letter size</a></p></div>`
        : dockCard.status === "button"
        ? `<div style="margin:28px 0 0;padding:16px 20px;background:#f8f3ea;border:1px solid #eaddc1;border-radius:8px;"><p style="margin:0 0 12px;font-size:14px;color:#6b5a2a;line-height:1.6;"><strong style="color:#4a3d17;">Her dock card is ready</strong> &mdash; ${cardBlurb}</p><a href="${cardUrl}" style="display:inline-block;background:#050b14;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px;">Download her dock card</a></div>`
        : dockCard.status === "unpublished"
        ? `<p style="margin:28px 0 0;font-size:14px;color:#6b7280;line-height:1.6;">Her dock card will be ready once her slideshow is published.</p>`
        : "";

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
            subject: `Your photos & video for ${vesselName} are ready`,
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

    // Reels are built from photographs, so a video-only delivery gets no line.
    // Nov 3: one quiet line under the main button — the two included reels —
    // replacing the old "first reel is one press away" box (reelNudgeHtml,
    // still used by notify-assistant).
    const reelLine = mediaType === "video"
      ? ""
      : `<p style="margin:16px 0 0;font-size:14px;color:#6b7280;line-height:1.6;">Two reels are included with her photos &mdash; made in about a minute. <a href="https://portal.yachtpics.com/dashboard/listings/${listing.id}/reel" style="color:#84662a;font-weight:600;text-decoration:none;">Make a reel &rarr;</a></p>`;

    const year = new Date().getFullYear();
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);"><div style="background:#050b14;padding:32px 40px;"><p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p></div><div style="padding:40px;"><h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">${copy.heading}, ${brokerName}</h1><p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">${copy.blurb}</p><p style="margin:0 0 32px;font-size:15px;color:#6b7280;line-height:1.6;">You can view, download, and share with clients directly from your listing.</p><a href="${portalUrl}" style="display:inline-block;background:#c39e4e;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;">${copy.cta} &rarr;</a>${reelLine}${dockCardHtml}</div><div style="padding:24px 40px;border-top:1px solid #f3f4f6;"><p style="margin:0 0 8px;font-size:13px;color:#9ca3af;">YachtPics &middot; Professional Yacht Photography<br>Questions? Reply to this email or visit <a href="https://yachtpics.com" style="color:#84662a;">yachtpics.com</a></p><p style="margin:0;font-size:11px;color:#d1d5db;line-height:1.5;">&copy; ${year} YachtPics. All photos and videos remain the intellectual property of YachtPics. Your payment grants a non-exclusive, non-transferable license to advertise the specific vessel shown. Sharing or transferring these files to any third party without a separate written license from YachtPics is prohibited.</p></div></div></body></html>`;

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
        ...(attachments.length ? { attachments } : {}),
      }),
    });

    // Resend can answer with a non-JSON body on a bad day; never let that skip the log row.
    const resendData: { id?: string; message?: string } = await resendRes.json().catch(() => ({}));

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
      metadata: { mediaType, dockCard: dockCard.status, ...(dockCard.detail ? { dockCardDetail: dockCard.detail } : {}) },
    });

    // Push the broker (and any assistants) that their media is ready — best effort.
    try {
      const { sendPushToUser } = await import("@/lib/sendPush");
      const payload = {
        title: copy.heading,
        body: `${vesselName} — view, download, and share from your portal.`,
        url: `/dashboard/listings/${listing.id}`,
        tag: `ready-${listing.id}`,
      };
      await sendPushToUser(listing.broker_id, payload);
      if (pushAssistants) {
        const { data: links } = await supabase
          .from("broker_assistants")
          .select("assistant_id")
          .eq("broker_id", listing.broker_id);
        await Promise.all((links ?? []).map((l) => sendPushToUser(l.assistant_id, payload)));
      }
    } catch {
      // push not configured / failed — never block the delivery email
    }

    if (!resendRes.ok) return NextResponse.json({ error: resendData.message ?? "Failed to send" }, { status: 500 });

    return NextResponse.json({ success: true, emailId: resendData.id, dockCard: dockCard.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
