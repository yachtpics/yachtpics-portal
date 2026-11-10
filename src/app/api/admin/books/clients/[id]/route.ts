import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";
import { clientFields } from "@/lib/books/clientInput";
import { isMissingColumn } from "@/lib/books/invoices";
import { ONLINE_PAY_NOT_READY } from "@/lib/books/types";

export const runtime = "nodejs";

// Edit a client (both logins share the list). Marks the row locally edited,
// so a later Zoho re-pull keeps these values (only the Zoho balance refreshes).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const { fields, error } = clientFields(body, false);
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!Object.keys(fields).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const now = new Date().toISOString();
  const update = (f: Record<string, unknown>) => admin
    .from("billing_clients")
    .update({ ...f, updated_at: now, updated_by: staff.profileId, local_edited_at: now })
    .eq("id", params.id)
    .select("id")
    .maybeSingle();
  let { data, error: upErr } = await update(fields);
  // Before 20261109 there's no online_pay column: save the rest (every client is "on" anyway).
  let droppedOff = false;
  if (upErr && "online_pay" in fields && isMissingColumn(upErr)) {
    droppedOff = fields.online_pay === false;
    const rest = { ...fields };
    delete rest.online_pay;
    ({ data, error: upErr } = await update(rest));
  }
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  if ("email" in fields) await admin.rpc("billing_relink_brokers", { only_client: params.id });
  if (droppedOff) return NextResponse.json({ error: `Saved, but ${ONLINE_PAY_NOT_READY}` }, { status: 503 });
  return NextResponse.json({ ok: true });
}
