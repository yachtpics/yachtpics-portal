import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

// POST /api/admin/brokerages/[id]/members  → add a broker or assistant to the brokerage
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  const { data: prof } = await admin.from("profiles").select("role").eq("id", body.userId).single();
  if (!prof) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (prof.role !== "broker" && prof.role !== "assistant") {
    return NextResponse.json({ error: "Only brokers and assistants can be added to a brokerage." }, { status: 400 });
  }

  const { error } = await admin.from("profiles").update({ brokerage_id: params.id }).eq("id", body.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE /api/admin/brokerages/[id]/members  → remove a member
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  const { error } = await admin
    .from("profiles")
    .update({ brokerage_id: null, is_shared_inventory: false })
    .eq("id", body.userId)
    .eq("brokerage_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// PATCH /api/admin/brokerages/[id]/members  → toggle shared inventory (brokers) or brokerage admin
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: { userId?: string; isShared?: boolean; brokerageAdmin?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  const update: Record<string, unknown> = {};

  if (typeof body.brokerageAdmin === "boolean") {
    update.is_brokerage_admin = body.brokerageAdmin;
  }
  if (typeof body.isShared === "boolean") {
    const { data: prof } = await admin.from("profiles").select("role").eq("id", body.userId).single();
    if (prof?.role !== "broker") {
      return NextResponse.json({ error: "Only broker accounts can hold shared inventory." }, { status: 400 });
    }
    update.is_shared_inventory = body.isShared;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await admin.from("profiles").update(update).eq("id", body.userId).eq("brokerage_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
