import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ClientHeader from "./_components/ClientHeader";

export const dynamic = "force-dynamic";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, first_name, last_name")
    .eq("id", user.id)
    .single();

  const role = profile?.role;
  if (role === "admin") redirect("/admin");
  if (role === "broker" || role === "assistant") redirect("/dashboard");

  const name = profile?.first_name
    ? `${profile.first_name} ${profile.last_name ?? ""}`.trim()
    : null;

  return (
    <div className="min-h-screen bg-ink-50">
      <ClientHeader name={name} />
      <main>{children}</main>
    </div>
  );
}
