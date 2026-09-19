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

  // A broker's brokerage lives in TWO places, and neither can be dropped:
  //   • profiles.brokerage_id        — the FK used for grouping, shared inventory and
  //                                    brokerage-admin permissions. Set right above.
  //   • broker_details.brokerage_name — free text, and the name everything customer-
  //                                    facing actually renders: the Reel end card,
  //                                    published site pages, branded emails.
  // Moving a broker by brokerage_id alone used to leave the text name pointing at the
  // old firm, so their Reel kept showing the brokerage they had left. The sync lives
  // here because this is the one place an admin changes which brokerage a broker
  // belongs to — writing both at the moment of the change is what keeps them in step.
  // Only brokers: assistants have no broker_details row and no branding of their own.
  if (prof.role === "broker") {
    const { data: brokerage } = await admin.from("brokerages").select("name").eq("id", params.id).single();
    if (brokerage?.name) {
      // Upsert, not update — a broker who has never saved their own profile has no
      // broker_details row yet, and an update would quietly match zero rows.
      const { error: detErr } = await admin
        .from("broker_details")
        .upsert({ id: body.userId, brokerage_name: brokerage.name }, { onConflict: "id" });
      if (detErr) return NextResponse.json({ error: detErr.message }, { status: 500 });
    }
  }

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

  // Deliberately NOT touching broker_details.brokerage_name here. Leaving a brokerage
  // makes a broker independent, not nameless — they still trade under a firm name and
  // their Reel end card still has to say something. Clearing it would blank their
  // branding. The admin can edit the text name on the broker page if it should change.
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
