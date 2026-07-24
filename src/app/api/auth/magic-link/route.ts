import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";
import { findExistingUser } from "@/lib/findExistingUser";

/**
 * Passwordless sign-in. The broker types their email, we generate a one-time
 * magic link ourselves (service role) and send it through Resend on our own
 * branded template — so delivery rides our existing, reliable pipeline instead
 * of Supabase's rate-limited default mailer.
 *
 * The link lands on /auth/confirm, which is CLICK-GATED: the token is only
 * consumed when the person presses a button. That's deliberate — corporate
 * mail scanners (HMY, etc.) pre-fetch links with a bare GET, which would burn a
 * normal one-time link before the user ever clicks. A button press is something
 * a scanner won't do, so the real user's link survives.
 *
 * We never reveal whether an account exists — same response either way.
 */
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
    }

    const cleanEmail = email.trim();
    const origin = new URL(req.url).origin;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Only existing accounts get a link. generateLink(type:magiclink) errors for
    // unknown emails; we treat that as "no account" and still return success so
    // the response can't be used to probe who has an account.
    const existing = await findExistingUser(supabase, cleanEmail);
    if (!existing) {
      return NextResponse.json({ success: true });
    }

    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: cleanEmail,
    });

    if (error || !data?.properties?.hashed_token) {
      // Don't leak the reason; log server-side for our own debugging.
      console.error("generateLink failed:", error?.message);
      return NextResponse.json({ success: true });
    }

    const tokenHash = data.properties.hashed_token;
    const confirmUrl = `${origin}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink`;

    const html = [
      "<!DOCTYPE html>",
      "<html>",
      "<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>",
      "<body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;\">",
      "  <div style=\"max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);\">",
      "    <div style=\"background:#050b14;padding:32px 40px;\">",
      "      <p style=\"margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;\">YachtPics <span style=\"color:#c39e4e;\">Portal</span></p>",
      "    </div>",
      "    <div style=\"padding:40px;\">",
      "      <h1 style=\"margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;\">Your sign-in link</h1>",
      "      <p style=\"margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;\">Click the button below to sign in to your YachtPics Portal — no password needed. This link works once and expires in about an hour.</p>",
      `      <a href="${confirmUrl}" style="display:inline-block;background:#c39e4e;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:24px;">Sign In to YachtPics &rarr;</a>`,
      "      <p style=\"margin:0;font-size:13px;color:#9ca3af;line-height:1.6;\">If you didn&apos;t request this, you can safely ignore this email — nobody can access your account without clicking the link above.</p>",
      "    </div>",
      "    <div style=\"padding:24px 40px;border-top:1px solid #f3f4f6;\">",
      "      <p style=\"margin:0;font-size:12px;color:#c5cbd2;\">Powered by <a href=\"https://yachtpics.com\" style=\"color:#c5cbd2;text-decoration:none;\">YachtPics</a></p>",
      "    </div>",
      "  </div>",
      "</body>",
      "</html>",
    ].join("\n");

    const subject = "Your YachtPics Portal sign-in link";

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "YachtPics <hello@yachtpics.com>",
        to: cleanEmail,
        subject,
        html,
      }),
    });

    await logEmail({
      emailType: "magic_link",
      recipientEmail: cleanEmail,
      recipientRole: existing.role === "assistant" ? "assistant" : existing.role === "broker" ? "broker" : null,
      recipientId: existing.id,
      subject,
      status: resendRes.ok ? "sent" : "failed",
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
