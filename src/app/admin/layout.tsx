import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AdminNav from "./_components/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") redirect("/dashboard");

  return (
    <div className="flex min-h-screen bg-ink-50">
      <AdminNav />
      <main className="flex-1 overflow-auto pb-20 md:pb-0 pt-12 md:pt-0">{children}</main>
    </div>
  );
}
