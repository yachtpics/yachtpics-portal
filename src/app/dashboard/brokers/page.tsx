import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function MyBrokersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "assistant") redirect("/dashboard");

  const { data: links } = await supabase
    .from("broker_assistants")
    .select("broker_id, profiles:broker_id(first_name, last_name, display_email, phone), broker_details:broker_id(brokerage_name, brokerage_website)")
    .eq("assistant_id", user.id);

  const brokers = (links ?? []).map((l) => {
    const p = l.profiles as unknown as { first_name: string | null; last_name: string | null; display_email: string | null; phone: string | null } | null;
    const d = l.broker_details as unknown as { brokerage_name: string | null; brokerage_website: string | null } | null;
    return {
      id: l.broker_id as string,
      name: p?.first_name ? (p.first_name + " " + (p.last_name ?? "")).trim() : p?.display_email ?? "Broker",
      email: p?.display_email ?? null,
      phone: p?.phone ?? null,
      brokerage_name: d?.brokerage_name ?? null,
      brokerage_website: d?.brokerage_website ?? null,
    };
  });

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">My Brokers</h1>
        <p className="text-gray-500 mt-1 text-sm">
          The brokers you currently assist on YachtPics Portal.
        </p>
      </div>

      {brokers.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
          <p className="text-gray-400 text-sm">No brokers linked yet.</p>
          <p className="text-gray-400 text-xs mt-1">Contact your YachtPics admin to get connected.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {brokers.map((broker) => (
            <div key={broker.id} className="bg-white border border-gray-200 rounded-xl px-6 py-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-base font-semibold text-gray-900">{broker.name}</p>
                  {broker.brokerage_name && (
                    <p className="text-sm text-[#c49a35] mt-0.5">{broker.brokerage_name}</p>
                  )}
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {broker.email && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs w-12">Email</span>
                    <a href={"mailto:" + broker.email} className="text-sm text-gray-700 hover:text-[#c49a35] transition-colors">{broker.email}</a>
                  </div>
                )}
                {broker.phone && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs w-12">Phone</span>
                    <a href={"tel:" + broker.phone} className="text-sm text-gray-700 hover:text-[#c49a35] transition-colors">{broker.phone}</a>
                  </div>
                )}
                {broker.brokerage_website && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs w-12">Web</span>
                    <a href={broker.brokerage_website} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-700 hover:text-[#c49a35] transition-colors">{broker.brokerage_website.replace(/^https?:\/\//, "")}</a>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
