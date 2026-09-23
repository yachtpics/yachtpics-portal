import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * The admin check for server-rendered pages under /admin.
 *
 * Why every page calls this, not just the admin layout: Next only re-renders
 * the segments that change on a client-side navigation, so a layout's checks
 * are SKIPPED when moving between pages beneath it — and a request can claim
 * the layout is already on screen. A check that lives only in the layout is
 * therefore not a security boundary. The middleware isn't one either (it only
 * redirects signed-out visitors, and never looked at role).
 *
 * Wrapped in React `cache()`, so when the layout and the page both call it in
 * the same request (a full page load), the lookup happens once.
 *
 * Uses `getUser()` — the token is verified by Supabase Auth, not just decoded.
 * Redirects signed-out visitors to /auth/login and non-admins to /dashboard,
 * exactly as the admin layout always has.
 */
export const requireAdminPage = cache(async (): Promise<{ userId: string }> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") redirect("/dashboard");

  return { userId: user.id };
});
