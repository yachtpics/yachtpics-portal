import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { logEmail } from "@/lib/logEmail";

export const runtime = "nodejs";

const SITE_URL = "https://portal.yachtpics.com";

function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `Gallery-${s}`;
}

function inviteHtml(opts: { firstName: string; galleryTitle: string; email: string; tempPwd: string | null }) {
  const loginBox = opts.tempPwd
    ? `<div style="background:#f8f3ea;border:1px solid #eaddc1;border-radius:10px;padding:20px 24px;margin:0 0 28px;">
         <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#84662a;text-transform:uppercase;">Your Login Details</p>
         <p style="margin:0 0 6px;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Login:</strong> portal.yachtpics.com/auth/login</p>
         <p style="margin:0 0 6px;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Email:</strong> ${opts.email}</p>
         <p style="margin:0;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Temporary password:</strong> <span style="font-family:monospace;font-size:14px;color:#111827;">${opts.tempPwd}</span></p>
       </div>`
    : `<div style="background:#f8f3ea;border:1px solid #eaddc1;border-radius:10px;padding:20px 24px;margin:0 0 28px;">
         <p style="margin:0;font-size:14px;color:#111827;">Log in with your existing YachtPics account at <strong>portal.yachtpics.com/auth/login</strong> to view it.</p>
       </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="background:#050b14;padding:32px 40px;">
        <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
      </div>
      <div style="padding:40px;">
        <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Your photos are ready${opts.firstName ? `, ${opts.firstName}` : ""}</h1>
        <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">The photos${""} for <strong style="color:#111827;">${opts.galleryTitle}</strong> are ready to view and download in your YachtPics gallery.</p>
        ${loginBox}
        <a href="${SITE_URL}/auth/login" style="display:inline-block;background:#c39e4e;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;">View Your Gallery &rarr;</a>
        <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;">From your gallery you can watch the slideshow, share it, and download the photos and videos.</p>
      </div>
      <div style="padding:24px 40px;border-top:1px solid #f3f4f6;">
        <p style="margin:0;font-size:11px;color:#d1d5db;">&copy; ${new Date().getFullYear()} YachtPics. All rights reserved.</p>
      </div>
    </div>
  </body></html>`;
}

// POST /api/admin/galleries/[id]/invite  → add a recipient (client login) to the gallery
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;
  const galleryId = params.id;

  let body: { email?: string; firstName?: string; lastName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = (body.email ?? "").trim();
  const firstName = (body.firstName ?? "").trim();
  const lastName = (body.lastName ?? "").trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const { data: gallery } = await admin.from("galleries").select("id, title").eq("id", galleryId).single();
  if (!gallery) return NextResponse.json({ error: "Gallery not found" }, { status: 404 });

  // Find an existing account with this email
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  let userId: string;
  let tempPwd: string | null = null;

  if (existing) {
    const { data: prof } = await admin.from("profiles").select("role").eq("id", existing.id).single();
    if (prof && ["broker", "admin", "assistant"].includes(prof.role)) {
      return NextResponse.json(
        { error: "That email belongs to a broker, assistant, or admin account and can't be used as a gallery client." },
        { status: 400 }
      );
    }
    userId = existing.id;
    await admin.from("profiles").upsert({
      id: userId,
      role: "client",
      display_email: email,
      ...(firstName ? { first_name: firstName } : {}),
      ...(lastName ? { last_name: lastName } : {}),
    });
  } else {
    tempPwd = tempPassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPwd,
      email_confirm: true,
      user_metadata: { role: "client" },
    });
    if (createErr || !created?.user) {
      return NextResponse.json({ error: createErr?.message ?? "Failed to create account" }, { status: 500 });
    }
    userId = created.user.id;
    await admin.from("profiles").upsert({
      id: userId,
      role: "client",
      display_email: email,
      first_name: firstName || null,
      last_name: lastName || null,
    });
  }

  // Link the client to the gallery
  const { error: linkErr } = await admin
    .from("gallery_access")
    .upsert({ gallery_id: galleryId, user_id: userId }, { onConflict: "gallery_id,user_id" });
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });

  // Send the invite / access email
  const subject = `Your photos are ready — ${gallery.title}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "YachtPics <hello@yachtpics.com>",
      to: email,
      subject,
      html: inviteHtml({ firstName, galleryTitle: gallery.title, email, tempPwd }),
    }),
  });

  await logEmail({
    emailType: "gallery_invite",
    recipientEmail: email,
    recipientRole: "client",
    recipientId: userId,
    subject,
    status: res.ok ? "sent" : "failed",
    metadata: { galleryId, galleryTitle: gallery.title },
  });

  return NextResponse.json({ success: true, userId, isNew: !existing, tempPassword: tempPwd });
}

// DELETE /api/admin/galleries/[id]/invite  → remove a recipient from the gallery
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  const { error } = await admin
    .from("gallery_access")
    .delete()
    .eq("gallery_id", params.id)
    .eq("user_id", body.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
