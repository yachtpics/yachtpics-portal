import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const brokerId = req.nextUrl.searchParams.get("id");
  if (!brokerId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data } = await supabase
    .from("broker_details")
    .select("brokerage_name, brokerage_website, logo_url")
    .eq("id", brokerId)
    .maybeSingle();

  return NextResponse.json(data ?? {});
}
