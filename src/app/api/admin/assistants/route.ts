import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { findExistingUser } from "@/lib/findExistingUser";

// POST /api/admin/assistants — invite a standalone assistant (admin only, no broker required)
export async function POST(req: NextRequest) {
  try {
    const { email, firstName, lastName } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    // Verify caller is admin
    const serverSupabase = await createServerClient();
    const { data: { user: caller } } = await serverSupabase.auth.getUser();
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: callerProfile } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (callerProfile?.role !== "admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if email already exists (reliable regardless of account count)
    const existing = await findExistingUser(supabase, email);

    let assistantId: string;
    let isNewUser = false;

    if (existing) {
      if (existing.role === "broker" || existing.role === "admin") {
        return NextResponse.json(
          { error: "This email belongs to a broker or admin account and cannot be added as an assistant." },
          { status: 400 }
        );
      }

      assistantId = existing.id;

      await supabase.from("profiles").upsert({
        id: assistantId,
        role: "assistant",
        display_email: email,
        first_name: existing.first_name ?? firstName ?? null,
        last_name: existing.last_name ?? lastName ?? null,
      });
    } else {
      isNewUser = true;

      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: "invite",
        email,
        options: {
          redirectTo: "https://portal.yachtpics.com/auth/set-password",
          data: { role: "assistant" },
        },
      });

      if (linkError || !linkData?.user) {
        return NextResponse.json({ error: linkError?.message ?? "Failed to generate invite link." }, { status: 500 });
      }

      assistantId = linkData.user.id;
      const inviteLink = linkData.properties?.action_link ?? "https://portal.yachtpics.com";

      await supabase.from("profiles").upsert({
        id: assistantId,
        role: "assistant",
        display_email: email,
        first_name: firstName ?? null,
        last_name: lastName ?? null,
      });

      const displayName = firstName ? `${firstName}${lastName ? " " + lastName : ""}` : "there";

      const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">You've been invited as an assistant</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">
        Hi ${displayName}, you've been set up as an assistant on YachtPics Portal. Set up your account below to get started.
      </p>
      <a href="${inviteLink}" style="display:inline-block;background:#c39e4e;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:24px;">Set Up Your Account &rarr;</a>
      <p style="margin:0 0 16px;font-size:13px;color:#6b7280;line-height:1.6;">
        As an assistant, you'll have access to manage listings, upload photos and videos, and send slideshows to clients on behalf of the brokers you're linked to.
      </p>
    </div>
    <div style="padding:24px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#c5cbd2;">Powered by <a href="https://yachtpics.com" style="color:#c5cbd2;text-decoration:none;">YachtPics</a></p>
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

      if (!resendRes.ok) {
        console.error("Email send failed:", await resendRes.text());
      }
    }

    return NextResponse.json({ success: true, assistantId, isNewUser });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
