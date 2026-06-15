import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { logEmail } from "@/lib/logEmail";

export const runtime = "nodejs";

const SITE_URL = "https://portal.yachtpics.com";

// POST /api/admin/galleries/[id]/send-slideshow  → email the (view-only) slideshow link
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin, userId } = auth;

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

  const { data: gallery } = await admin
    .from("galleries")
    .select("id, title, slug, slideshow_published")
    .eq("id", params.id)
    .single();
  if (!gallery) return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
  if (!gallery.slideshow_published) {
    return NextResponse.json({ error: "This gallery's slideshow isn't published." }, { status: 400 });
  }

  const url = `${SITE_URL}/g/${gallery.slug}`;
  const messageBlock = message
    ? `<div style="background:#f8f9fa;border-radius:8px;padding:16px 20px;margin-bottom:24px;"><p style="margin:0;font-size:15px;color:#374151;line-height:1.6;white-space:pre-wrap;">${message}</p></div>`
    : "";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="background:#050b14;padding:32px 40px;">
        <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Gallery</span></p>
      </div>
      <div style="padding:40px;">
        <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#111827;">${gallery.title}</h1>
        <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">You've been sent a slideshow to view.</p>
        ${messageBlock}
        <a href="${url}" style="display:inline-flex;align-items:center;gap:8px;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;">▶ View Slideshow</a>
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
    sentBy: userId,
    metadata: { galleryId: gallery.id, galleryTitle: gallery.title },
  });

  if (!res.ok) return NextResponse.json({ error: data.message ?? "Failed to send" }, { status: 500 });
  return NextResponse.json({ success: true });
}
