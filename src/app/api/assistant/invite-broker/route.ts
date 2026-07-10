import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";
import { findExistingUser } from "@/lib/findExistingUser";

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `Portal-${suffix}`;
}

export async function POST(req: NextRequest) {
  try {
    const { firstName, lastName, email, brokerage } = await req.json();

    if (!firstName || !lastName || !email) {
      return NextResponse.json({ error: "First name, last name, and email are required." }, { status: 400 });
    }

    // Verify caller is an assistant
    const supabaseUser = await createServerClient();
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: callerProfile } = await supabaseUser
      .from("profiles")
      .select("role, first_name, last_name")
      .eq("id", user.id)
      .single();

    if (callerProfile?.role !== "assistant") {
      return NextResponse.json({ error: "Assistant access required." }, { status: 403 });
    }

    const assistantName = callerProfile.first_name
      ? `${callerProfile.first_name}${callerProfile.last_name ? " " + callerProfile.last_name : ""}`
      : "Your assistant";

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if a user with this email already exists
    const existing = await findExistingUser(supabase, email);
    if (existing) {
      return NextResponse.json({ error: "An account with that email already exists. Use the Connect panel to link to them instead." }, { status: 409 });
    }

    // Create account with temp password
    const tempPassword = generateTempPassword();

    const { data: newUserData, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });

    if (createError || !newUserData?.user) {
      return NextResponse.json({ error: createError?.message ?? "Failed to create broker account." }, { status: 500 });
    }

    const brokerId = newUserData.user.id;

    // Create profile row
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: brokerId,
      role: "broker",
      first_name: firstName,
      last_name: lastName,
      display_email: email,
      invited_by: user.id,
    });

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    // Create broker_details row if brokerage provided
    if (brokerage?.trim()) {
      await supabase.from("broker_details").upsert({
        id: brokerId,
        brokerage_name: brokerage.trim(),
      });
    }

    // Link this assistant to the new broker immediately
    const { error: linkErr } = await supabase.from("broker_assistants").upsert(
      { broker_id: brokerId, assistant_id: user.id },
      { onConflict: "broker_id,assistant_id" }
    );

    if (linkErr) {
      return NextResponse.json({ error: linkErr.message }, { status: 500 });
    }

    // Send branded invite email with credentials
    const htmlLines = [
      "<!DOCTYPE html>",
      "<html>",
      "<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>",
      "<body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;\">",
      "  <div style=\"max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);\">",
      "    <div style=\"background:#050b14;padding:32px 40px;\">",
      "      <p style=\"margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;\">YachtPics <span style=\"color:#c39e4e;\">Portal</span></p>",
      "    </div>",
      "    <div style=\"padding:40px;\">",
      `      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Welcome, ${firstName}</h1>`,
      `      <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">${assistantName} has set up your YachtPics Portal account. Use the details below to log in and get started.</p>`,
      "      <div style=\"background:#f8f3ea;border:1px solid #eaddc1;border-radius:10px;padding:20px 24px;margin:0 0 28px;\">",
      "        <p style=\"margin:0 0 12px;font-size:13px;font-weight:600;color:#84662a;text-transform:uppercase;\">Your Login Details</p>",
      "        <p style=\"margin:0 0 6px;font-size:13px;color:#6b7280;\"><strong style=\"color:#111827;\">Login:</strong> portal.yachtpics.com/auth/login</p>",
      `        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Email:</strong> ${email}</p>`,
      `        <p style="margin:0;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Temporary password:</strong> <span style="font-family:monospace;font-size:14px;color:#111827;">${tempPassword}</span></p>`,
      "      </div>",
      "      <a href=\"https://portal.yachtpics.com/auth/login\" style=\"display:inline-block;background:#c39e4e;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:28px;\">Log In to Your Portal &rarr;</a>",
      "      <p style=\"margin:0 0 20px;font-size:13px;color:#6b7280;line-height:1.6;\">Once you're in, you can view and download your photos, share professional slideshows with clients, manage your listings, and track who's viewing your content.</p>",
      "      <p style=\"margin:0;font-size:13px;color:#9ca3af;line-height:1.6;\">You can update your password from your profile settings at any time.</p>",
      "    </div>",
      "    <div style=\"padding:24px 40px;border-top:1px solid #f3f4f6;\">",
      "      <p style=\"margin:0;font-size:12px;color:#c5cbd2;\">Powered by <a href=\"https://yachtpics.com\" style=\"color:#c5cbd2;text-decoration:none;\">YachtPics</a></p>",
      "    </div>",
      "  </div>",
      "</body>",
      "</html>",
    ];
    const html = htmlLines.join("\n");

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "YachtPics <hello@yachtpics.com>",
        to: email,
        subject: "You've been invited to YachtPics Portal",
        html,
      }),
    });

    const resendData = await resendRes.json();

    await logEmail({
      emailType: "broker_invite",
      recipientEmail: email,
      recipientRole: "broker",
      recipientId: brokerId,
      brokerId,
      subject: "You've been invited to YachtPics Portal",
      status: resendRes.ok ? "sent" : "failed",
      sentBy: user.id,
    });

    if (!resendRes.ok) {
      return NextResponse.json({ error: resendData.message ?? "Account created but invite email failed to send." }, { status: 500 });
    }

    return NextResponse.json({ success: true, brokerId, tempPassword });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
