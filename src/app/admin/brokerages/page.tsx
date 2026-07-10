import { createClient as createServiceClient } from "@supabase/supabase-js";
import Link from "next/link";
import NewBrokerageForm from "./_components/NewBrokerageForm";
import RefreshOnMount from "./_components/RefreshOnMount";

export const dynamic = "force-dynamic";

export default async function AdminBrokeragesPage() {
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: brokerages } = await supabase
    .from("brokerages")
    .select("id, name, created_at, subscription_status")
    .order("name");

  const ids = (brokerages ?? []).map((b) => b.id);
  const counts = new Map<string, { brokers: number; assistants: number }>();
  if (ids.length > 0) {
    const { data: members } = await supabase.from("profiles").select("brokerage_id, role").in("brokerage_id", ids);
    for (const m of members ?? []) {
      if (!m.brokerage_id) continue;
      const c = counts.get(m.brokerage_id) ?? { brokers: 0, assistants: 0 };
      if (m.role === "broker") c.brokers++;
      else if (m.role === "assistant") c.assistants++;
      counts.set(m.brokerage_id, c);
    }
  }

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <RefreshOnMount />
      <div className="mb-6">
        <h1 className="text-display text-ink-900">Brokerages</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Group brokers and assistants. Assistants in a brokerage see every broker&apos;s boats, and brokers also see any shared &ldquo;house&rdquo; / new-inventory accounts.
        </p>
      </div>

      <NewBrokerageForm />

      {(!brokerages || brokerages.length === 0) ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-16 text-center">
          <p className="text-ink-400 text-sm">No brokerages yet. Create one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {brokerages.map((b) => {
            const c = counts.get(b.id) ?? { brokers: 0, assistants: 0 };
            return (
              <Link
                key={b.id}
                href={`/admin/brokerages/${b.id}`}
                className="flex items-center justify-between bg-white border border-hairline rounded-card shadow-elev-1 px-5 py-4 hover:border-accent-500 transition-colors duration-fast ease-quiet"
              >
                <div>
                  <p className="font-semibold text-ink-900 flex items-center gap-2">
                    {b.name}
                    {(b.subscription_status === "active" || b.subscription_status === "trialing") && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-success-50 text-success-700 border border-success-200 uppercase tracking-wide">
                        Office {b.subscription_status === "trialing" ? "Trial" : "Plan"}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-500 mt-0.5">
                    {c.brokers} broker{c.brokers !== 1 ? "s" : ""} · {c.assistants} assistant{c.assistants !== 1 ? "s" : ""}
                  </p>
                </div>
                <span className="text-accent-700 text-xs font-medium">Manage &rarr;</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
