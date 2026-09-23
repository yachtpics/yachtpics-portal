import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin edits to one video row: whether it's in the client slideshow, and its
 * place in the listing's video order.
 *
 * Goes through the service role rather than the browser client because the
 * repo's `videos` RLS (supabase/videos-setup.sql) grants brokers select/insert
 * only and has no admin policy at all — and a PostgREST update that RLS
 * filters out returns no error, so a browser write could "succeed" and change
 * nothing.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: { in_slideshow?: unknown; display_order?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const patch: { in_slideshow?: boolean; display_order?: number } = {};
  if (body.in_slideshow !== undefined) {
    if (typeof body.in_slideshow !== "boolean") {
      return NextResponse.json({ error: "in_slideshow must be true or false" }, { status: 400 });
    }
    patch.in_slideshow = body.in_slideshow;
  }
  if (body.display_order !== undefined) {
    const n = body.display_order;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 100000) {
      return NextResponse.json({ error: "display_order must be a non-negative whole number" }, { status: 400 });
    }
    patch.display_order = n;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("videos")
    .update(patch)
    .eq("id", params.id)
    .select("id, in_slideshow, display_order")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Video not found" }, { status: 404 });
  return NextResponse.json({ ok: true, video: data });
}
