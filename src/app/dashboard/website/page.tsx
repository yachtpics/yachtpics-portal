import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WebsiteEditor from "./WebsiteEditor";

export const dynamic = "force-dynamic";

/**
 * Dashboard → Website (Oct 26): the broker's personal site at /b/{slug}.
 * Brokers edit their own; assistants pick the broker they work for; an admin
 * arrives with ?brokerId= from the admin broker page. All reads and writes go
 * through /api/website, which resolves who may act for whom.
 */
export default async function WebsitePage({ searchParams }: { searchParams: { brokerId?: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=/dashboard/website");
  const brokerId = typeof searchParams.brokerId === "string" && /^[0-9a-f-]{36}$/i.test(searchParams.brokerId) ? searchParams.brokerId : null;
  return <WebsiteEditor initialBrokerId={brokerId} />;
}
