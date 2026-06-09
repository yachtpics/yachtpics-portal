import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type AdminOk = { admin: SupabaseClient; userId: string; error?: undefined };
type AdminErr = { error: NextResponse; admin?: undefined; userId?: undefined };

/**
 * Verifies the caller is signed in AND has the `admin` role.
 * Returns a service-role client (`admin`) on success, or a ready-to-return
 * NextResponse error. Middleware only checks login for /admin, never role,
 * so every admin API route must call this itself.
 */
export async function requireAdmin(): Promise<AdminOk | AdminErr> {
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
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { admin, userId: user.id };
}
