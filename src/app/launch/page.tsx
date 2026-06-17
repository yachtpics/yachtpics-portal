import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// PWA launch target. The installed app opens here, and we forward each user to
// the right home based on their role — so admins land on the admin console,
// gallery clients on their client area, and everyone else on the dashboard.
export const dynamic = "force-dynamic";

export default async function LaunchPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = profile?.role ?? "broker";

  if (role === "admin") redirect("/admin");
  if (role === "client") redirect("/client");
  redirect("/dashboard");
}
