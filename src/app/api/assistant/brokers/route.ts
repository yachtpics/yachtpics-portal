import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

// POST /api/assistant/brokers — assistant links themselves to a broker
export async function POST(req: NextRequest) {
  try {
    const { brokerId } = await req.json();

    if (!brokerId) {
      return NextResponse.json({ error: "brokerId is required." }, { status: 400 });
    }

    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: callerProfile } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (callerProfile?.role !== "assistant") {
      return NextResponse.json({ error: "Assistant access required." }, { status: 403 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify broker exists
    const { data: brokerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", brokerId)
      .single();

    if (!brokerProfile || brokerProfile.role !== "broker") {
      return NextResponse.json({ error: "Broker not found." }, { status: 404 });
    }

    const { error } = await supabase
      .from("broker_assistants")
      .upsert(
        { broker_id: brokerId, assistant_id: user.id },
        { onConflict: "broker_id,assistant_id" }
      );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/assistant/brokers — assistant unlinks themselves from a broker
export async function DELETE(req: NextRequest) {
  try {
    const { brokerId } = await req.json();

    if (!brokerId) {
      return NextResponse.json({ error: "brokerId is required." }, { status: 400 });
    }

    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: callerProfile } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (callerProfile?.role !== "assistant") {
      return NextResponse.json({ error: "Assistant access required." }, { status: 403 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await supabase
      .from("broker_assistants")
      .delete()
      .eq("broker_id", brokerId)
      .eq("assistant_id", user.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
