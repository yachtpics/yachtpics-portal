import { createClient as createServiceClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import Link from "next/link";
import BrokerageMembers from "./_components/BrokerageMembers";
import RefreshOnMount from "../_components/RefreshOnMount";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_email: string | null;
  role: string;
  brokerage_id: string | null;
  is_shared_inventory: boolean | null;
  is_brokerage_admin: boolean | null;
};

export default async function BrokerageDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: brokerage } = await supabase.from("brokerages").select("id, name").eq("id", params.id).single();
  if (!brokerage) notFound();

  const { data: allRaw } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, display_email, role, brokerage_id, is_shared_inventory, is_brokerage_admin")
    .in("role", ["broker", "assistant"])
    .order("last_name");
  const all = (allRaw ?? []) as Row[];

  const fmtName = (p: Row) =>
    p.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : (p.display_email ?? "—");

  const members = all
    .filter((p) => p.brokerage_id === params.id)
    .map((p) => ({ id: p.id, name: fmtName(p), email: p.display_email, role: p.role, isShared: !!p.is_shared_inventory, isBrokerageAdmin: !!p.is_brokerage_admin }));

  const available = all
    .filter((p) => p.brokerage_id !== params.id)
    .map((p) => ({ id: p.id, name: fmtName(p), email: p.display_email, role: p.role, inOtherBrokerage: !!p.brokerage_id }));

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <RefreshOnMount />
      <Link href="/admin/brokerages" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">&larr; All brokerages</Link>
      <BrokerageMembers
        brokerageId={brokerage.id}
        brokerageName={brokerage.name}
        initialMembers={members}
        available={available}
      />
    </div>
  );
}
