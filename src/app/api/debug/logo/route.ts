import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "Pass ?email=your@email.com" });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Find user by email
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
  const user = users.find(u => u.email === email);
  if (!user) return NextResponse.json({ error: "User not found" });

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
