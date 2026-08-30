import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { hasAccess } from "@/lib/subscriptionAccess";
import { logEmail } from "@/lib/logEmail";
import { signVideoUrl } from "@/lib/videoUrls";

export async function POST(req: NextRequest) {
  try {
    const { listingId, clientEmail, message, includeSlideshow, documentIds, videoIds } = await req.json();
    if (!listingId || !clientEmail) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: listing } = await supabaseAdmin
      .from("listings")
      .select("id, vessel_name, broker_id, slideshow_slug, slideshow_published")
      .eq("id", listingId)
      .single();

    if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });

    // Verify caller is the broker, a linked assistant, or a co-broker on this listing
    const access = await assertListingAccess(supabaseAdmin, listingId, user.id, { includeCoBroker: true });
    if (access instanceof NextResponse) return access;

    // Send-to-Client is a paid feature. Gate on the listing OWNER's effective
    // access (their own plan or an office plan). Expired brokers can still
    // download delivered photos — that's always free — but not send to clients.
    const { status: ownerAccess } = await getEffectiveAccessStatus(supabaseAdmin, listing.broker_id);
    if (!hasAccess(ownerAccess)) {
      return NextResponse.json(
        { error: "This plan has ended. Subscribe to send listings to clients — downloading delivered photos always stays free." },
        { status: 403 }
      );
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name, display_email")
      .eq("id", listing.broker_id)
      .single();

    const { data: brokerDetails } = await supabaseAdmin
      .from("broker_details")
      .select("brokerage_name")
      .eq("id", listing.broker_id)
      .single();

    const brokerName = profile?.first_name
      ? `${profile.first_name} ${profile.last_name ?? ""}`.trim()
      : profile?.display_email ?? "Your Broker";
    const brokerage = brokerDetails?.brokerage_name ?? "";
    const brokerEmail = profile?.display_email;
    const vesselName = listing.vessel_name ?? "this vessel";
    const slideshowUrl = listing.slideshow_published && listing.slideshow_slug
      ? `https://portal.yachtpics.com/s/${listing.slideshow_slug}`
      : null;

    const docLinks: { filename: string; url: string }[] = [];
    if (documentIds?.length > 0) {
      const { data: docs } = await supabaseAdmin
        .from("documents")
        .select("id, storage_path, filename")
        .in("id", documentIds)
        .eq("listing_id", listingId);

      for (const doc of docs ?? []) {
        const { data: signed } = await supabaseAdmin.storage
          .from("listing-documents")
          .createSignedUrl(doc.storage_path, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) {
          docLinks.push({ filename: doc.filename ?? "document.pdf", url: signed.signedUrl });
        }
      }
    }

    const videoLinks: { filename: string; url: string }[] = [];
    if (videoIds?.length > 0) {
      const { data: vids } = await supabaseAdmin
        .from("videos")
        .select("id, storage_path, storage_host, filename")
        .in("id", videoIds)
        .eq("listing_id", listingId);
      // A week, matching the document links above — these sit in an inbox.
      for (const v of vids ?? []) {
        const url = await signVideoUrl(supabaseAdmin, v, { expiresIn: 60 * 60 * 24 * 7 });
        if (url) videoLinks.push({ filename: v.filename ?? "video.mp4", url });
      }
    }

    const messageBlock = message
      ? `<div style="background:#f7f8f9;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
           <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;white-space:pre-wrap;">${message}</p>
         </div>`
      : "";

    const slideshowBlock = includeSlideshow && slideshowUrl
      ? `<div style="margin-bottom:20px;">
           <a href="${slideshowUrl}" style="display:inline-flex;align-items:center;gap:8px;background:#050b14;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;">
             <span>&#9658;</span> View Photo Gallery
           </a>
         </div>`
      : "";

    const docsBlock = docLinks.length > 0
      ? `<div style="margin-top:20px;">
           <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;">Documents</p>
           ${docLinks.map(d => `
             <a href="${d.url}" style="display:flex;align-items:center;gap:10px;background:#f7f8f9;border-radius:8px;padding:12px 16px;text-decoration:none;margin-bottom:8px;">
               <span style="font-size:18px;">&#128196;</span>
               <span style="font-size:14px;font-weight:500;color:#111827;">${d.filename}</span>
               <span style="margin-left:auto;font-size:12px;color:#84662a;font-weight:600;">Download &#8594;</span>
             </a>
           `).join("")}
         </div>`
      : "";

    const videosBlock = videoLinks.length > 0
      ? `<div style="margin-top:20px;">
           <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;">Videos</p>
           ${videoLinks.map(v => `
             <a href="${v.url}" style="display:flex;align-items:center;gap:10px;background:#f7f8f9;border-radius:8px;padding:12px 16px;text-decoration:none;margin-bottom:8px;">
               <span style="font-size:18px;">&#127909;</span>
               <span style="font-size:14px;font-weight:500;color:#111827;">${v.filename}</span>
               <span style="margin-left:auto;font-size:12px;color:#84662a;font-weight:600;">Watch &#8594;</span>
             </a>
           `).join("")}
         </div>`
      : "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <div style="background:#050b14;padding:32px 40px;">
          <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
        </div>
        <div style="padding:40px;">
          <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#111827;">${vesselName}</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Sent by ${brokerName}${brokerage ? ` &middot; ${brokerage}` : ""}</p>
          ${messageBlock}
          ${slideshowBlock}
          ${videosBlock}
          ${docsBlock}
        </div>
        <div style="padding:24px 40px;border-top:1px solid #f3f4f6;">
          <p style="margin:0 0 6px;font-size:12px;color:#c5cbd2;">Powered by <a href="https://yachtpics.com" style="color:#c5cbd2;text-decoration:none;">YachtPics</a></p>
          <p style="margin:0;font-size:11px;color:#d1d5db;">&copy; ${new Date().getFullYear()} YachtPics. All photos and videos are the intellectual property of YachtPics. All rights reserved.</p>
        </div>
      </div>
    </body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${brokerName} <hello@yachtpics.com>`,
        reply_to: brokerEmail ? [brokerEmail] : undefined,
        to: clientEmail,
        subject: `${vesselName} — from ${brokerName}`,
        html,
      }),
    });

    const data = await res.json();

    await logEmail({
      emailType: "client_send",
      recipientEmail: clientEmail,
      recipientRole: "client",
      brokerId: listing.broker_id,
      listingId,
      subject: `${vesselName} — from ${brokerName}`,
      status: res.ok ? "sent" : "failed",
      error: res.ok ? null : (data.message ?? "Failed to send"),
      sentBy: user.id,
    });

    if (!res.ok) return NextResponse.json({ error: data.message ?? "Failed to send" }, { status: 500 });

    // Log the send for history tracking (broker_id = listing owner, sent_by = actual sender)
    await supabaseAdmin.from("client_sends").insert({
      listing_id: listingId,
      broker_id: listing.broker_id,
      sent_by: user.id,
      client_email: clientEmail,
      message: message || null,
      included_slideshow: !!(includeSlideshow && slideshowUrl),
      document_count: docLinks.length,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
