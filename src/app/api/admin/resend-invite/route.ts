import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `Portal-${suffix}`;
}

export async function POST(req: NextRequest) {
  const { brokerId } = await req.json();
  if (!brokerId) return NextResponse.json({ error: "Missing brokerId" }, { status: 400 });

  // Verify caller is admin
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: callerProfile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (callerProfile?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get broker's email
  const { data: authUser, error: fetchError } = await supabase.auth.admin.getUserById(brokerId);
  if (fetchError || !authUser?.user?.email) {
    return NextResponse.json({ error: "Could not find broker account" }, { status: 404 });
  }

  const email = authUser.user.email;

  // Fetch broker name
  const { data: brokerProfile } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", brokerId)
    .single();
  const firstName = brokerProfile?.first_name ?? "";

  // Generate and set a new temp password
  const tempPassword = generateTempPassword();
  const { error: updateError } = await supabase.auth.admin.updateUserById(brokerId, {
    password: tempPassword,
  });

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Send email with new credentials
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
    `      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">${firstName ? firstName + ", your" : "Your"} new login details</h1>`,
    "      <p style=\"margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;\">Your YachtPics Portal access has been refreshed. Use the details below to log in.</p>",
    "      <div style=\"background:#f8f3ea;border:1px solid #eaddc1;border-radius:10px;padding:20px 24px;margin:0 0 28px;\">",
    "        <p style=\"margin:0 0 12px;font-size:13px;font-weight:600;color:#84662a;text-transform:uppercase;\">Your Login Details</p>",
    "        <p style=\"margin:0 0 6px;font-size:13px;color:#6b7280;\"><strong style=\"color:#111827;\">Login:</strong> portal.yachtpics.com/auth/login</p>",
    `        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Email:</strong> ${email}</p>`,
    `        <p style="margin:0;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Temporary password:</strong> <span style="font-family:monospace;font-size:14px;color:#111827;">${tempPassword}</span></p>`,
    "      </div>",
    "      <a href=\"https://portal.yachtpics.com/auth/login\" style=\"display:inline-block;background:#c39e4e;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:20px;\">Log In to Your Portal &rarr;</a>",
    "      <p style=\"margin:0;font-size:13px;color:#9ca3af;line-height:1.6;\">Once logged in, you can update your password from your profile settings. If you were not expecting this email, please contact us.</p>",
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
      subject: "Your YachtPics Portal login details",
      html,
    }),
  });

  await logEmail({
    emailType: "resend_invite",
    recipientEmail: email,
    recipientRole: "broker",
    recipientId: brokerId,
    brokerId,
    subject: "Your YachtPics Portal login details",
    status: resendRes.ok ? "sent" : "failed",
    sentBy: user.id,
  });

  if (!resendRes.ok) {
    return NextResponse.json({ error: "Password reset but email failed to send." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, tempPassword, type: "temp_password", message: "New login details sent" });
}
