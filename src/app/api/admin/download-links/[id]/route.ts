import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

// PATCH /api/admin/download-links/[id]  → revoke (or un-revoke) a link
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let revoked = true;
  try {
    const body = await req.json();
    if (typeof body?.revoked === "boolean") revoked = body.revoked;
  } catch {
    /* default to revoke */
  }

  const { error } = await admin
    .from("download_links")
    .update({ revoked })
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, revoked });
}

// DELETE /api/admin/download-links/[id]  → remove a link entirely
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  const { error } = await admin.from("download_links").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
