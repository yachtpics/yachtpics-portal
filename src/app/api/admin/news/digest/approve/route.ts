import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { DIGEST_SELECT, renderDigestHtml, type DigestRow } from "@/lib/newsDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Approve & publish.
 *
 * Renders the markdown to HTML, stores it on the row, and moves the status to
 * `approved`. That is the moment the piece becomes visible: brokers can read
 * it in the portal and yachtpics.com picks it up from /api/news/public. No
 * email goes out here — sending is a separate, deliberate second press.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "Which digest?" }, { status: 400 });

  const { data: current, error: readError } = await admin
    .from("news_digests")
    .select(DIGEST_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "That digest is gone" }, { status: 404 });

  const row = current as unknown as DigestRow;
  const html = renderDigestHtml({ body_md: row.body_md });
  if (!html) return NextResponse.json({ error: "There's nothing to publish yet" }, { status: 400 });

  // A sent piece stays sent — re-approving must not walk the status backwards.
  const patch: { html: string; status?: string; approved_at: string } = {
    html,
    approved_at: row.approved_at ?? new Date().toISOString(),
  };
  if (row.status !== "sent") patch.status = "approved";

  const { data, error } = await admin
    .from("news_digests")
    .update(patch)
    .eq("id", id)
    .select(DIGEST_SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, digest: data });
}
