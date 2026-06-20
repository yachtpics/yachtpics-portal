import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";

export const runtime = "nodejs";

const PORTAL = "https://portal.yachtpics.com";

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim().slice(0, 120);
    const email = String(body.email ?? "").trim().slice(0, 160);
    const phone = String(body.phone ?? "").trim().slice(0, 40);
    const message = String(body.message ?? "").trim().slice(0, 2000);
    const source = (String(body.source ?? "slideshow").slice(0, 24).replace(/[^a-z0-9_-]/gi, "") || "slideshow");

    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "Please enter your name and a valid email." }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Resolve the published listing behind this slug.
    const { data: listing } = await supabase
      .from("listings")
      .select("id, vessel_name, broker_id")
      .eq("slideshow_slug", params.slug)
      .eq("slideshow_published", true)
      .single();
    if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });

    // Record the lead.
    await supabase.from("listing_leads").insert({
      listing_id: listing.id,
      broker_id: listing.broker_id,
      name, email, phone: phone || null, message: message || null,
      source,
    });

    const vessel = listing.vessel_name ?? "your listing";

    // Notify the broker (and co-brokers / assistants) — best effort.
    try {
      const { data: broker } = await supabase
        .from("profiles")
        .select("first_name, display_email")
        .eq("id", listing.broker_id)
        .single();

      // Push (broker + co-brokers + assistants)
      try {
        const { sendPushToUser } = await import("@/lib/sendPush");
        const payload = {
          title: `New inquiry — ${vessel}`,
          body: `${name} just asked about ${vessel}.`,
          url: `/dashboard/listings/${listing.id}`,
          tag: `lead-${listing.id}`,
        };
        const recipients = new Set<string>([listing.broker_id]);
        const { data: co } = await supabase.from("listing_co_brokers").select("broker_id").eq("listing_id", listing.id);
        (co ?? []).forEach((r) => recipients.add(r.broker_id as string));
        const { data: asst } = await supabase.from("broker_assistants").select("assistant_id").eq("broker_id", listing.broker_id);
        (asst ?? []).forEach((r) => recipients.add(r.assistant_id as string));
        await Promise.all(Array.from(recipients).map((id) => sendPushToUser(id, payload)));
      } catch { /* push not configured */ }

      // Email the broker
      if (broker?.display_email) {
        const subject = `New inquiry on ${vessel}`;
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;"><p style="margin:0;font-size:20px;font-weight:600;color:#fff;">YachtPics <span style="color:#d4a843;">Portal</span></p></div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">New inquiry on ${esc(vessel)}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Someone just reached out from your slideshow. Reach back out while it's hot.</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">
        <tr><td style="padding:6px 0;font-size:14px;color:#6b7280;width:80px;">Name</td><td style="padding:6px 0;font-size:14px;color:#111827;font-weight:600;">${esc(name)}</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#6b7280;">Email</td><td style="padding:6px 0;font-size:14px;"><a href="mailto:${esc(email)}" style="color:#a07820;">${esc(email)}</a></td></tr>
        ${phone ? `<tr><td style="padding:6px 0;font-size:14px;color:#6b7280;">Phone</td><td style="padding:6px 0;font-size:14px;"><a href="tel:${esc(phone)}" style="color:#a07820;">${esc(phone)}</a></td></tr>` : ""}
        ${message ? `<tr><td style="padding:6px 0;font-size:14px;color:#6b7280;vertical-align:top;">Message</td><td style="padding:6px 0;font-size:14px;color:#374151;line-height:1.5;">${esc(message)}</td></tr>` : ""}
      </table>
      <a href="${PORTAL}/dashboard/listings/${listing.id}" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:8px;">View the listing</a>
    </div>
  </div>
</body></html>`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: "YachtPics <hello@yachtpics.com>", to: broker.display_email, reply_to: email, subject, html }),
        });
        await logEmail({
          emailType: "listing_inquiry",
          recipientEmail: broker.display_email,
          recipientRole: "broker",
          recipientId: listing.broker_id,
          brokerId: listing.broker_id,
          listingId: listing.id,
          subject,
          status: res.ok ? "sent" : "failed",
          metadata: { leadName: name, leadEmail: email },
        });
      }
    } catch { /* never fail the buyer's submission on a notification error */ }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
