import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

// POST /api/admin/brokerages  → create a brokerage
export async function POST(req: NextRequest) {
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

  const { data, error } = await admin.from("brokerages").insert({ name }).select("id, name").single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed to create" }, { status: 500 });
  return NextResponse.json({ brokerage: data });
}
