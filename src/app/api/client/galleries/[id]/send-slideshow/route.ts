import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";

export const runtime = "nodejs";

const SITE_URL = "https://portal.yachtpics.com";

// POST /api/client/galleries/[id]/send-slideshow
// Lets a logged-in gallery recipient email the (view-only) slideshow link.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // The sender must be a recipient of this gallery
  const { data: access } = await service
    .from("gallery_access")
    .select("id")
    .eq("gallery_id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!access) return NextResponse.json({ error: "No access" }, { status: 403 });

  let body: { email?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const message = (body.message ?? "").trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const { data: gallery } = await service
    .from("galleries")
    .select("title, slug, slideshow_published")
    .eq("id", params.id)
    .single();
  if (!gallery || !gallery.slideshow_published) {
    return NextResponse.json({ error: "This gallery's slideshow isn't available." }, { status: 400 });
  }

  // Sender's display name (for a friendlier from/intro)
  const { data: prof } = await service
    .from("profiles")
    .select("first_name, last_name, display_email")
    .eq("id", user.id)
    .single();
  const senderName = prof?.first_name ? `${prof.first_name} ${prof.last_name ?? ""}`.trim() : (prof?.display_email ?? "");

  const url = `${SITE_URL}/g/${gallery.slug}`;
  const messageBlock = message
    ? `<div style="background:#f7f8f9;border-radius:8px;padding:16px 20px;margin-bottom:24px;"><p style="margin:0;font-size:15px;color:#374151;line-height:1.6;white-space:pre-wrap;">${message}</p></div>`
    : "";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="background:#050b14;padding:32px 40px;">
        <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Gallery</span></p>
      </div>
      <div style="padding:40px;">
        <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#111827;">${gallery.title}</h1>
        <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">${senderName ? `${senderName} shared a slideshow with you.` : "A slideshow has been shared with you."}</p>
        ${messageBlock}
        <a href="${url}" style="display:inline-flex;align-items:center;gap:8px;background:#c39e4e;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;">▶ View Slideshow</a>
        <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">If the button doesn't work, paste this link into your browser:<br><span style="color:#6b7280;word-break:break-all;">${url}</span></p>
      </div>
      <div style="padding:24px 40px;border-top:1px solid #f3f4f6;">
        <p style="margin:0;font-size:11px;color:#d1d5db;">&copy; ${new Date().getFullYear()} YachtPics. All rights reserved.</p>
      </div>
    </div>
  </body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "YachtPics <hello@yachtpics.com>",
      reply_to: prof?.display_email ? [prof.display_email] : undefined,
      to: email,
      subject: `${gallery.title} — slideshow`,
      html,
    }),
  });
  const data = await res.json();

  await logEmail({
    emailType: "gallery_slideshow",
    recipientEmail: email,
    subject: `${gallery.title} — slideshow`,
    status: res.ok ? "sent" : "failed",
    error: res.ok ? null : (data.message ?? "Failed to send"),
    sentBy: user.id,
    metadata: { galleryId: params.id, galleryTitle: gallery.title, sentByRecipient: true },
  });

  if (!res.ok) return NextResponse.json({ error: data.message ?? "Failed to send" }, { status: 500 });
  return NextResponse.json({ success: true });
}
