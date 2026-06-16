import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Ok = { admin: SupabaseClient; userId: string; brokerageId: string; error?: undefined };
type Err = { error: NextResponse; admin?: undefined; userId?: undefined; brokerageId?: undefined };

/**
 * Verifies the caller is a brokerage admin (is_brokerage_admin = true with a
 * brokerage). Returns a service-role client plus their brokerage id, or an error.
 */
export async function requireBrokerageAdmin(): Promise<Ok | Err> {
  const supabaseUser = await createServerClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: profile } = await admin
    .from("profiles")
    .select("is_brokerage_admin, brokerage_id")
    .eq("id", user.id)
    .single();

  if (!profile?.is_brokerage_admin || !profile.brokerage_id) {
    return { error: NextResponse.json({ error: "Brokerage admin access required." }, { status: 403 }) };
  }

  return { admin, userId: user.id, brokerageId: profile.brokerage_id };
}

const PW_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeTempPassword(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += PW_CHARS[Math.floor(Math.random() * PW_CHARS.length)];
  return `Portal-${s}`;
}

export function inviteEmailHtml(opts: { firstName: string; brokerageName: string; email: string; tempPwd: string; roleLabel: string }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="background:#050b14;padding:32px 40px;"><p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Portal</span></p></div>
      <div style="padding:40px;">
        <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Welcome${opts.firstName ? `, ${opts.firstName}` : ""}</h1>
        <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">You've been set up on the YachtPics Portal as a ${opts.roleLabel} for <strong style="color:#111827;">${opts.brokerageName}</strong>. Use the details below to log in.</p>
        <div style="background:#f9f5ec;border:1px solid #e8d9a0;border-radius:10px;padding:20px 24px;margin:0 0 28px;">
          <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#92721a;text-transform:uppercase;letter-spacing:0.5px;">Your Login Details</p>
          <p style="margin:0 0 6px;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Login:</strong> portal.yachtpics.com/auth/login</p>
          <p style="margin:0 0 6px;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Email:</strong> ${opts.email}</p>
          <p style="margin:0;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Temporary password:</strong> <span style="font-family:monospace;font-size:14px;color:#111827;">${opts.tempPwd}</span></p>
        </div>
        <a href="https://portal.yachtpics.com/auth/login" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;">Log In to Your Portal &rarr;</a>
        <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;">Once logged in you can update your password from your profile settings.</p>
      </div>
      <div style="padding:24px 40px;border-top:1px solid #f3f4f6;"><p style="margin:0;font-size:11px;color:#d1d5db;">&copy; ${new Date().getFullYear()} YachtPics. All rights reserved.</p></div>
    </div>
  </body></html>`;
}
