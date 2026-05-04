import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function DELETE(req: NextRequest) {
  try {
    const { brokerId } = await req.json();
    if (!brokerId) return NextResponse.json({ error: "Missing brokerId" }, { status: 400 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Delete auth user (cascades to most related data if FK constraints set)
    const { error: authError } = await supabase.auth.admin.deleteUser(brokerId);
    if (authError) return NextResponse.json({ error: authError.message }, { status: 500 });

    // Clean up profile rows (in case FK doesn't cascade)
    await supabase.from("broker_details").delete().eq("id", brokerId);
    await supabase.from("subscriptions").delete().eq("broker_id", brokerId);
    await supabase.from("profiles").delete().eq("id", brokerId);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
