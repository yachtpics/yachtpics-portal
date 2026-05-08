import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

// POST /api/admin/assistants/[id] — link a broker to this assistant
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const assistantId = params.id;
    const { brokerId } = await req.json();

    if (!brokerId) {
      return NextResponse.json({ error: "brokerId is required." }, { status: 400 });
    }

    const serverSupabase = await createServerClient();
    const { data: { user: caller } } = await serverSupabase.auth.getUser();
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: callerProfile } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (callerProfile?.role !== "admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify assistant exists and has assistant role
    const { data: assistantProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", assistantId)
      .single();

    if (!assistantProfile || assistantProfile.role !== "assistant") {
      return NextResponse.json({ error: "Assistant not found." }, { status: 404 });
    }

    const { error } = await supabase
      .from("broker_assistants")
      .upsert(
        { broker_id: brokerId, assistant_id: assistantId },
        { onConflict: "broker_id,assistant_id" }
      );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/admin/assistants/[id]
// - With body { brokerId }: unlink that broker from this assistant
// - With body { deleteAccount: true }: fully delete the assistant account
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const assistantId = params.id;
    const body = await req.json();

    const serverSupabase = await createServerClient();
    const { data: { user: caller } } = await serverSupabase.auth.getUser();
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: callerProfile } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (callerProfile?.role !== "admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    if (body.deleteAccount) {
      // Full account deletion: remove all related records then auth user
      await supabase.from("broker_assistants").delete().eq("assistant_id", assistantId);
      await supabase.from("notifications").delete().eq("user_id", assistantId);
      await supabase.from("profiles").delete().eq("id", assistantId);
      const { error: authErr } = await supabase.auth.admin.deleteUser(assistantId);
      if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 });
      return NextResponse.json({ success: true, deleted: true });
    }

    // Unlink a single broker
    const { brokerId } = body;
    if (!brokerId) {
      return NextResponse.json({ error: "brokerId or deleteAccount is required." }, { status: 400 });
    }

    await supabase
      .from("broker_assistants")
      .delete()
      .eq("broker_id", brokerId)
      .eq("assistant_id", assistantId);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
