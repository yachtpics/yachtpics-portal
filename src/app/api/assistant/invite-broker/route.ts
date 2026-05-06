import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

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
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const alreadyExists = existingUsers?.users?.some((u) => u.email === email);
    if (alreadyExists) {
      return NextResponse.json({ error: "An account with that email already exists. Use the Connect panel to link to them instead." }, { status: 409 });
    }

    // Generate invite link
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo: "https://portal.yachtpics.com/auth/set-password" },
    });

    if (linkError || !linkData?.user) {
      return NextResponse.json({ error: linkError?.message ?? "Failed to generate invite link." }, { status: 500 });
    }

    const brokerId = linkData.user.id;
    const inviteLink = linkData.properties?.action_link ?? "https://portal.yachtpics.com";

    // Create profile row
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: brokerId,
      role: "broker",
      first_name: firstName,
      last_name: lastName,
      display_email: email,
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

    // Send branded invite email via Resend
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Welcome, ${firstName}</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">${assistantName} has set up your YachtPics Portal account. Click below to create your password and get started.</p>
      <a href="${inviteLink}" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:28px;">Set Up Your Account &rarr;</a>
      <p style="margin:0 0 20px;font-size:13px;color:#6b7280;line-height:1.6;">Once you're in, you can view and download your photos, share professional slideshows with clients, manage your listings, and track who's viewing your content.</p>
      <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">If you weren't expecting this invitation, you can safely ignore this email.</p>
    </div>
    <div style="padding:24px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#c4c9d4;">Powered by <a href="https://yachtpics.com" style="color:#c4c9d4;text-decoration:none;">YachtPics</a></p>
    </div>
  </div>
</body>
</html>`;

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
    if (!resendRes.ok) {
      return NextResponse.json({ error: resendData.message ?? "Account created but invite email failed to send." }, { status: 500 });
    }

    return NextResponse.json({ success: true, brokerId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
