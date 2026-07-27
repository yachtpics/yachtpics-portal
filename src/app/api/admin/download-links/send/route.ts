import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { logEmail } from "@/lib/logEmail";

export const runtime = "nodejs";

const SITE_URL = "https://portal.yachtpics.com";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin, userId } = auth;

  let body: { linkId?: string; email?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { linkId, email, message } = body;
  if (!linkId || !email) {
    return NextResponse.json({ error: "Missing link or email" }, { status: 400 });
  }

  // Accept one or several addresses — comma, semicolon, space, or newline
  // separated — and send each recipient their own copy so they never see each
  // other's address.
  const recipients = Array.from(
    new Set(
      String(email)
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    )
  );
  if (recipients.length === 0) {
    return NextResponse.json({ error: "Enter at least one valid email address." }, { status: 400 });
  }

  const { data: link } = await admin
    .from("download_links")
    .select("id, token, revoked, expires_at, listing_id")
    .eq("id", linkId)
    .single();

  if (!link) return NextResponse.json({ error: "Link not found" }, { status: 404 });
  if (link.revoked) return NextResponse.json({ error: "This link has been revoked." }, { status: 400 });
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "This link has expired." }, { status: 400 });
  }

  const { data: listing } = await admin
    .from("listings")
    .select("vessel_name")
    .eq("id", link.listing_id)
    .single();

  const vesselName = listing?.vessel_name ?? "your vessel";
  const url = `${SITE_URL}/d/${link.token}`;

  const messageBlock = message
    ? `<div style="background:#f7f8f9;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
         <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;white-space:pre-wrap;">${message}</p>
       </div>`
    : "";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="background:#050b14;padding:32px 40px;">
        <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
      </div>
      <div style="padding:40px;">
        <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#111827;">${vesselName} — Photo Download</h1>
        <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">You've been sent a private link to download the photos for this vessel.</p>
        ${messageBlock}
        <div style="margin-bottom:20px;">
          <a href="${url}" style="display:inline-flex;align-items:center;gap:8px;background:#c39e4e;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;">
            Download Photos &#8594;
          </a>
        </div>
        <p style="margin:0;font-size:12px;color:#9ca3af;">If the button doesn't work, copy and paste this link into your browser:<br><span style="color:#6b7280;word-break:break-all;">${url}</span></p>
      </div>
      <div style="padding:24px 40px;border-top:1px solid #f3f4f6;">
        <p style="margin:0;font-size:11px;color:#d1d5db;">&copy; ${new Date().getFullYear()} YachtPics. All photos and videos are the intellectual property of YachtPics. All rights reserved.</p>
      </div>
    </div>
  </body></html>`;

  let sent = 0;
  const failed: string[] = [];

  for (const recipient of recipients) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "YachtPics <hello@yachtpics.com>",
        to: recipient,
        subject: `${vesselName} — Photo Download`,
        html,
      }),
    });

    let data: { message?: string } = {};
    try { data = await res.json(); } catch { /* non-JSON body */ }

    await logEmail({
      emailType: "download_link",
      recipientEmail: recipient,
      listingId: link.listing_id,
      subject: `${vesselName} — Photo Download`,
      status: res.ok ? "sent" : "failed",
      error: res.ok ? null : (data.message ?? "Failed to send"),
      sentBy: userId,
    });

    if (res.ok) sent++;
    else failed.push(recipient);
  }

  if (sent === 0) {
    return NextResponse.json(
      { error: "Couldn't send to any of those addresses. Please check them and try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, sent, failed });
}
