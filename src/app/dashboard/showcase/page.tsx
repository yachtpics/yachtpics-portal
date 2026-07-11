import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ShowcaseGrid from "@/components/ShowcaseGrid";

export const dynamic = "force-dynamic";

export default async function ShowcasePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  return <ShowcaseGrid />;
}
