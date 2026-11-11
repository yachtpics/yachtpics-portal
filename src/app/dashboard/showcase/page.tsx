import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { isDemoUser } from "@/lib/demo";
import ShowcaseGrid from "@/components/ShowcaseGrid";
import ShowcaseVisitLogger from "@/components/ShowcaseVisitLogger";

export const dynamic = "force-dynamic";

export default async function ShowcasePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  // Read-only demo (M1): Recently Photographed is other brokers' boats — not
  // shown (the nav hides the entry; this covers a typed URL).
  if (isDemoUser(user)) {
    return (
      <div className="max-w-xl mx-auto px-6 py-16 text-center">
        <h1 className="text-xl font-semibold text-ink-900 mb-2">Recently Photographed</h1>
        <p className="text-sm text-ink-500">Brokers see the boats YachtPics has just photographed here. It isn&apos;t part of the demo.</p>
      </div>
    );
  }

  return (
    <>
      <ShowcaseVisitLogger />
      <ShowcaseGrid />
    </>
  );
}
