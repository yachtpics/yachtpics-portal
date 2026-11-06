import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";
import { clientFields } from "@/lib/books/clientInput";

export const runtime = "nodejs";

// Add a client to the shared list (both logins). Billing staff only.
export async function POST(req: NextRequest) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const { fields, error } = clientFields(body, true);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const now = new Date().toISOString();
  const { data, error: insErr } = await admin
    .from("billing_clients")
    .insert({ ...fields, created_by: staff.profileId, updated_by: staff.profileId, created_at: now, updated_at: now })
    .select("id")
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  await admin.rpc("billing_relink_brokers", { only_client: data.id });
  return NextResponse.json({ ok: true, id: data.id });
}
