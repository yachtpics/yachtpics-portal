import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

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

  // Use service role to look up email and resend invite
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get the broker's email from auth.users via admin API
  const { data: authUser, error: fetchError } = await supabase.auth.admin.getUserById(brokerId);
  if (fetchError || !authUser?.user?.email) {
    return NextResponse.json({ error: "Could not find broker email" }, { status: 404 });
  }

  const email = authUser.user.email;

  // Resend invite — works for users who haven't confirmed yet.
  // For confirmed users, falls back to a password reset email.
  const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
  });

  if (inviteError) {
    // User is already confirmed — send a password reset instead
    if (inviteError.message?.toLowerCase().includes("already been registered") ||
        inviteError.message?.toLowerCase().includes("already exists") ||
        inviteError.code === "email_exists") {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?type=recovery`,
      });
      if (resetError) {
        return NextResponse.json({ error: resetError.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, type: "reset", message: "Password reset email sent" });
    }
    return NextResponse.json({ error: inviteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, type: "invite", message: "Invite email sent" });
}
