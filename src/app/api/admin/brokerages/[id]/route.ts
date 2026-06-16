import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

// PATCH /api/admin/brokerages/[id]  → rename
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });

  const { error } = await admin.from("brokerages").update({ name }).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE /api/admin/brokerages/[id]  → delete the brokerage (members are detached)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  // Detach members and clear shared-inventory flags before removing the group
  await admin.from("profiles").update({ is_shared_inventory: false }).eq("brokerage_id", params.id);
  // FK on profiles.brokerage_id is ON DELETE SET NULL, so deleting the row clears membership
  const { error } = await admin.from("brokerages").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
