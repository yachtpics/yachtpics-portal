import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const { email, brokerId, firstName, lastName } = await req.json();

    if (!email || !brokerId) {
      return NextResponse.json({ error: "Email and brokerId are required." }, { status: 400 });
    }

    // Verify caller is admin OR is the broker themselves
    const serverSupabase = await createServerClient();
    const { data: { user: caller } } = await serverSupabase.auth.getUser();
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: callerProfile } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    const isAdmin = callerProfile?.role === "admin";
    const isBroker = callerProfile?.role === "broker" && caller.id === brokerId;
    if (!isAdmin && !isBroker) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Fetch broker name for the email
    const { data: brokerProfile } = await serverSupabase
      .from("profiles")
      .select("first_name, last_name, display_email")
      .eq("id", brokerId)
      .single();
    const brokerName = brokerProfile?.first_name
      ? `${brokerProfile.first_name} ${brokerProfile.last_name ?? ""}`.trim()
      : brokerProfile?.display_email ?? "your broker";

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if this email already exists
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const existingUser = users.find(u => u.email?.toLowerCase() === email.toLowerCase());

    let assistantId: string;
    let isNewUser = false;

    if (existingUser) {
      // Existing user — verify they're an assistant (not broker/admin)
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("role, first_name, last_name")
        .eq("id", existingUser.id)
        .single();

      if (existingProfile?.role === "broker" || existingProfile?.role === "admin") {
        return NextResponse.json(
          { error: "This email belongs to a broker or admin account and cannot be added as an assistant." },
          { status: 400 }
        );
      }

      assistantId = existingUser.id;

      // Ensure their role is assistant
      await supabase.from("profiles").upsert({
        id: assistantId,
        role: "assistant",
        display_email: email,
        first_name: existingProfile?.first_name ?? firstName ?? null,
        last_name: existingProfile?.last_name ?? lastName ?? null,
      });
    } else {
      // New user — generate invite
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

      // Create profile
      await supabase.from("profiles").upsert({
        id: assistantId,
        role: "assistant",
        display_email: email,
        first_name: firstName ?? null,
        last_name: lastName ?? null,
      });

      // Send invite email
      const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">You've been added as an assistant</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">
        <strong style="color:#111827;">${brokerName}</strong> has invited you to manage their listings on YachtPics Portal.
        Set up your account below to get started.
      </p>
      <a href="${inviteLink}" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:24px;">Set Up Your Account &rarr;</a>
      <p style="margin:0 0 16px;font-size:13px;color:#6b7280;line-height:1.6;">
        As an assistant, you'll have full access to ${brokerName}'s listings — you can upload photos and videos, manage listing details, and send slideshows to clients on their behalf.
      </p>
      <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
        If you're already assisting other brokers on the portal, this account will give you access to all of them in one place.
      </p>
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
          subject: `${brokerName} has invited you to YachtPics Portal`,
          html,
        }),
      });

      if (!resendRes.ok) {
        // Non-fatal — account created, email failed
        console.error("Email send failed:", await resendRes.text());
      }
    }

    // Create broker_assistants link (upsert so duplicates are safe)
    const { error: linkErr } = await supabase
      .from("broker_assistants")
      .upsert(
        { broker_id: brokerId, assistant_id: assistantId },
        { onConflict: "broker_id,assistant_id" }
      );

    if (linkErr) {
      return NextResponse.json({ error: linkErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, assistantId, isNewUser });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { brokerId, assistantId } = await req.json();
    if (!brokerId || !assistantId) {
      return NextResponse.json({ error: "brokerId and assistantId required." }, { status: 400 });
    }

    const serverSupabase = await createServerClient();
    const { data: { user: caller } } = await serverSupabase.auth.getUser();
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: callerProfile } = await serverSupabase
      .from("profiles").select("role").eq("id", caller.id).single();

    const isAdmin = callerProfile?.role === "admin";
    const isBroker = callerProfile?.role === "broker" && caller.id === brokerId;
    if (!isAdmin && !isBroker) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await supabase.from("broker_assistants")
      .delete()
      .eq("broker_id", brokerId)
      .eq("assistant_id", assistantId);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
