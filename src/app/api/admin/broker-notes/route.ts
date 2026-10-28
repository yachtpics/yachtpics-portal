import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/broker-notes { brokerId, notes } — private notes about a
 * broker (Oct 28). Admins only; broker_admin_notes has RLS on and no
 * policies, so it's read and written only through the service role here and
 * on the admin broker page. Never exposed to brokers or assistants.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { brokerId?: unknown; notes?: unknown };
  const brokerId = typeof body.brokerId === "string" && /^[0-9a-f-]{36}$/i.test(body.brokerId) ? body.brokerId : null;
  if (!brokerId) return NextResponse.json({ error: "Missing broker." }, { status: 400 });
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 5000) : "";
  const now = new Date().toISOString();
  const { error } = await auth.admin.from("broker_admin_notes").upsert(
    { broker_id: brokerId, notes: notes || null, updated_at: now, updated_by: auth.userId },
    { onConflict: "broker_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updatedAt: now });
}
