import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";
import { clientFields } from "@/lib/books/clientInput";
import { isMissingColumn } from "@/lib/books/invoices";
import { ONLINE_PAY_NOT_READY } from "@/lib/books/types";

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
  const insert = (f: Record<string, unknown>) => admin
    .from("billing_clients")
    .insert({ ...f, created_by: staff.profileId, updated_by: staff.profileId, created_at: now, updated_at: now })
    .select("id")
    .single();
  let { data, error: insErr } = await insert(fields);
  // Before 20261109 there's no online_pay column: save the rest (every client is "on" anyway).
  let droppedOff = false;
  if (insErr && "online_pay" in fields && isMissingColumn(insErr)) {
    droppedOff = fields.online_pay === false;
    const rest = { ...fields };
    delete rest.online_pay;
    ({ data, error: insErr } = await insert(rest));
  }
  if (insErr || !data) return NextResponse.json({ error: insErr?.message ?? "Couldn't add the client." }, { status: 500 });

  await admin.rpc("billing_relink_brokers", { only_client: data.id });
  if (droppedOff) return NextResponse.json({ error: `Client added, but ${ONLINE_PAY_NOT_READY}`, id: data.id }, { status: 503 });
  return NextResponse.json({ ok: true, id: data.id });
}
