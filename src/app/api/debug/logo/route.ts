import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabaseUser = await createServerClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Try both columns so we can see which one finds the row
  const { data: byId } = await supabaseAdmin
    .from("broker_details")
    .select("id, broker_id, logo_url, brokerage_name")
    .eq("id", user.id)
    .single();

  const { data: byBrokerId } = await supabaseAdmin
    .from("broker_details")
    .select("id, broker_id, logo_url, brokerage_name")
    .eq("broker_id", user.id)
    .single();

  return NextResponse.json({
    user_id: user.id,
    row_found_by_id: byId,
    row_found_by_broker_id: byBrokerId,
  });
}
