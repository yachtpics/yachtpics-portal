import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

// Set (or clear) which admin a broker is attributed to. Admin-only.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: { adminId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const adminId = body.adminId || null;

  // If assigning to someone, make sure they're actually an admin.
  if (adminId) {
    const { data: target } = await admin.from("profiles").select("role").eq("id", adminId).single();
    if (target?.role !== "admin") {
      return NextResponse.json({ error: "That account isn't an admin." }, { status: 400 });
    }
  }

  const { error } = await admin.from("profiles").update({ invited_by: adminId }).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, invitedBy: adminId });
}
