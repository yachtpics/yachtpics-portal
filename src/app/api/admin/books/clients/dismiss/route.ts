import { NextRequest, NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";

export const runtime = "nodejs";

// "Keep both": mark every pair in a possible-duplicate group as reviewed (owner only).
export async function POST(req: NextRequest) {
  const auth = await requireBillingStaff({ ownerOnly: true });
  if (auth.error) return auth.error;
  const { admin, staff } = auth;

  const body = (await req.json().catch(() => null)) as { ids?: string[] } | null;
  const ids = Array.isArray(body?.ids) ? body!.ids!.filter((x) => typeof x === "string") : [];
  if (ids.length < 2 || ids.length > 50) return NextResponse.json({ error: "Pick the clients to keep." }, { status: 400 });

  const rows: { client_a: string; client_b: string; created_by: string }[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] < ids[j] ? ids[i] : ids[j];
      const b = ids[i] < ids[j] ? ids[j] : ids[i];
      if (a !== b) rows.push({ client_a: a, client_b: b, created_by: staff.profileId });
    }
  }
  const { error } = await admin
    .from("billing_client_dupe_dismissals")
    .upsert(rows, { onConflict: "client_a,client_b", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
