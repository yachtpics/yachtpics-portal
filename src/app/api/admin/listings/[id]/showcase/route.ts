import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only opt-in for the "Recently Photographed" showcase.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: { show?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const show = body.show === true;

  const patch: Record<string, unknown> = { in_showcase: show };
  // Stamp the photographed date the first time it's added; keep it on re-toggle.
  if (show) {
    const { data: cur } = await admin
      .from("listings")
      .select("photographed_at")
      .eq("id", params.id)
      .maybeSingle();
    if (!cur?.photographed_at) patch.photographed_at = new Date().toISOString();
  }

  const { error } = await admin.from("listings").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: "Could not update the showcase" }, { status: 500 });

  return NextResponse.json({ ok: true, in_showcase: show });
}
